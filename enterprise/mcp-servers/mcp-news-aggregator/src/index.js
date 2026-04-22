const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { z } = require('zod');
const axios = require('axios');
const cheerio = require('cheerio');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const express = require('express');

const PORT = parseInt(process.env.MCP_SERVER_PORT || '3010', 10);
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

function log(level, msg, meta) {
  if (LOG_LEVEL === 'debug' || level === 'error' || level === 'info') {
    console.error(`[${new Date().toISOString()}] [${level.toUpperCase()}] ${msg}`, meta || '');
  }
}

async function fetchRSSFeed(feedUrl) {
  try {
    const response = await axios.get(feedUrl, {
      timeout: 10000,
      headers: { 'User-Agent': 'NewsAggregator/1.0' }
    });
    const $ = cheerio.load(response.data, { xmlMode: true });
    const items = [];

    const parseEntry = (el) => {
      const title = $(el).find('title').text().trim();
      const link = $(el).find('link[rel="alternate"]').attr('href') ||
                   $(el).find('link').attr('href') || '';
      const description = $(el).find('description, content, summary').text().trim();
      const pubDate = $(el).find('pubDate, published, updated').text().trim();
      return {
        title,
        url: link,
        summary: description.replace(/<[^>]*>/g, '').slice(0, 300),
        publishedAt: pubDate
      };
    };

    const entries = $('entry');
    const itemsEl = $('item');

    if (entries.length > 0) {
      for (let i = 0; i < entries.length; i++) {
        items.push(parseEntry(entries[i]));
      }
    } else if (itemsEl.length > 0) {
      for (let i = 0; i < itemsEl.length; i++) {
        items.push(parseEntry(itemsEl[i]));
      }
    }
    return items;
  } catch (error) {
    log('error', `Failed to fetch RSS: ${feedUrl}`, { error: String(error) });
    return [];
  }
}

function generateArticle(items, title) {
  const sections = [];

  sections.push(`# ${title}\n`);
  sections.push(`**作者**: theneoai\n`);
  sections.push(`**联系邮箱**: lucas_hsueh@hotmail.com\n\n`);
  sections.push('---\n\n');

  const byTopic = { headline: [], tech: [], industry: [], social: [] };

  for (const item of items.slice(0, 15)) {
    const t = (item.title + ' ' + item.summary).toLowerCase();
    if (t.includes('release') || t.includes('launch') || t.includes('announce')) {
      byTopic.headline.push(item);
    } else if (t.includes('tutorial') || t.includes('guide') || t.includes('research') || t.includes('paper')) {
      byTopic.tech.push(item);
    } else if (t.includes('funding') || t.includes('partner') || t.includes('acquire')) {
      byTopic.industry.push(item);
    } else {
      byTopic.social.push(item);
    }
  }

  if (byTopic.headline.length > 0) {
    sections.push('## 🔥 今日头条\n\n');
    for (const item of byTopic.headline.slice(0, 2)) {
      sections.push(`### 📌 ${item.title}\n\n`);
      sections.push(`${item.summary}\n\n`);
      if (item.url) sections.push(`📎 来源: ${item.title}\n\n`);
    }
  }

  if (byTopic.tech.length > 0) {
    sections.push('## 💡 技术洞见\n\n');
    for (const item of byTopic.tech.slice(0, 3)) {
      sections.push(`### ⚙️ ${item.title}\n\n`);
      sections.push(`${item.summary}\n\n`);
      if (item.url) sections.push(`📎 来源: ${item.title}\n\n`);
    }
  }

  if (byTopic.industry.length > 0) {
    sections.push('## 📰 行业动态\n\n');
    for (const item of byTopic.industry.slice(0, 2)) {
      sections.push(`### 🚀 ${item.title}\n\n`);
      sections.push(`${item.summary}\n\n`);
    }
  }

  if (byTopic.social.length > 0) {
    sections.push('## 🐦 社区热聊\n\n');
    for (const item of byTopic.social.slice(0, 2)) {
      sections.push(`### 💬 ${item.title}\n\n`);
      sections.push(`${item.summary}\n\n`);
    }
  }

  return sections.join('');
}

function formatForWeChat(markdown) {
  return markdown
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^---$/gm, '<hr>');
}

async function publishToWeChat(title, content, appId, appSecret) {
  if (!appId || !appSecret) {
    return { success: false, error: 'WeChat credentials not configured' };
  }

  try {
    const tokenRes = await axios.get(
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`
    );

    if (!tokenRes.data.access_token) {
      return { success: false, error: tokenRes.data.errmsg || 'Failed to get access token' };
    }

    const token = tokenRes.data.access_token;
    const articleContent = formatForWeChat(content);

    const draftRes = await axios.post(
      `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${token}`,
      {
        articles: [{
          title,
          author: 'theneoai',
          digest: content.slice(0, 54),
          content: articleContent,
          content_source_url: '',
          thumb_media_id: '',
          need_open_comment: 0,
          only_fans_can_comment: 0
        }]
      }
    );

    if (draftRes.data.errcode === 0) {
      return { success: true, draftId: draftRes.data.media_id };
    }
    return { success: false, error: draftRes.data.errmsg };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

function createMcpServer() {
  const s = new McpServer({
    name: 'mcp-news-aggregator',
    version: '1.0.0',
  });

  s.tool(
    'collect_ai_news',
    'Collect latest AI tech news from RSS feeds. Returns aggregated news items.',
    {
      maxItems: z.number().optional().describe('Maximum items to collect (default 20)')
    },
    async ({ maxItems = 20 }) => {
      log('info', 'Collecting AI news from RSS feeds');

      const configPath = path.resolve(__dirname, '../../../../configs/news-aggregator/rss-feeds.yml');
      let feeds = [];

      try {
        if (fs.existsSync(configPath)) {
          const config = yaml.load(fs.readFileSync(configPath, 'utf-8'));
          feeds = config.feeds || [];
        }
      } catch (e) {
        log('warn', 'Could not load RSS config, using default feeds');
      }

      if (feeds.length === 0) {
        feeds = [
          { id: 'hn-ai', name: 'Hacker News AI', url: 'https://hnrss.org/newest?q=AI%20OR%20machine%20learning' },
          { id: 'openai', name: 'OpenAI Blog', url: 'https://openai.com/blog/rss.xml' },
          { id: 'deepmind', name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml' },
        ];
      }

      const allItems = [];
      for (const feed of feeds.slice(0, 6)) {
        const items = await fetchRSSFeed(feed.url);
        allItems.push(...items.map(i => ({ ...i, source: feed.name })));
        if (allItems.length >= maxItems * 2) break;
      }

      const result = allItems.slice(0, maxItems);
      log('info', `Collected ${result.length} news items`);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ items: result, count: result.length }, null, 2)
        }]
      };
    }
  );

  s.tool(
    'generate_news_article',
    'Generate a formatted AI news article from collected items. Returns markdown article.',
    {
      newsData: z.string().describe('JSON string of news items from collect_ai_news'),
      date: z.string().optional().describe('Date for the article (default today)')
    },
    async ({ newsData, date }) => {
      log('info', 'Generating news article');
      const items = JSON.parse(newsData);
      const today = date || new Date().toLocaleDateString('zh-CN');
      const title = `[AI 周观察] ${today} | AI 技术热点速递`;

      const content = generateArticle(items.items || [], title);

      return {
        content: [{ type: 'text', text: content }]
      };
    }
  );

  s.tool(
    'publish_wechat_draft',
    'Publish article as WeChat draft. Returns draft ID.',
    {
      title: z.string().describe('Article title'),
      content: z.string().describe('Article content in markdown')
    },
    async ({ title, content }) => {
      log('info', 'Publishing to WeChat');
      const appId = process.env.WECHAT_APP_ID;
      const appSecret = process.env.WECHAT_APP_SECRET;

      const result = await publishToWeChat(title, content, appId, appSecret);

      if (result.success) {
        return {
          content: [{ type: 'text', text: `草稿已创建！草稿ID: ${result.draftId}\n请到微信公众号后台发布。` }]
        };
      } else {
        return {
          content: [{ type: 'text', text: `发布失败: ${result.error}` }],
          isError: true
        };
      }
    }
  );

  s.tool(
    'run_full_workflow',
    'Run the complete AI news aggregation workflow: collect news, generate article, and optionally publish to WeChat.',
    {
      publishToWeChat: z.boolean().optional().describe('Whether to publish to WeChat (default false)')
    },
    async ({ publishToWeChat: shouldPublish }) => {
      log('info', 'Running full news aggregation workflow');

      const configPath = path.resolve(__dirname, '../../../../configs/news-aggregator/rss-feeds.yml');
      let feeds = [];

      try {
        if (fs.existsSync(configPath)) {
          const config = yaml.load(fs.readFileSync(configPath, 'utf-8'));
          feeds = config.feeds || [];
        }
      } catch (e) {
        feeds = [
          { id: 'hn-ai', name: 'Hacker News AI', url: 'https://hnrss.org/newest?q=AI%20OR%20machine%20learning' },
          { id: 'openai', name: 'OpenAI Blog', url: 'https://openai.com/blog/rss.xml' },
          { id: 'deepmind', name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml' },
        ];
      }

      const allItems = [];
      for (const feed of feeds.slice(0, 6)) {
        const items = await fetchRSSFeed(feed.url);
        allItems.push(...items.map(i => ({ ...i, source: feed.name })));
      }

      const title = `[AI 周观察] ${new Date().toLocaleDateString('zh-CN')} | AI 技术热点速递`;
      const content = generateArticle(allItems.slice(0, 20), title);

      let publishResult = null;
      if (shouldPublish) {
        const appId = process.env.WECHAT_APP_ID;
        const appSecret = process.env.WECHAT_APP_SECRET;
        publishResult = await publishToWeChat(title, content, appId, appSecret);
      }

      const output = { title, content, itemsCollected: allItems.length, published: shouldPublish ? publishResult : null };

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
      };
    }
  );

  return s;
}

async function main() {
  const app = express();
  const transports = new Map();

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'mcp-news-aggregator', timestamp: new Date().toISOString() });
  });

  app.get('/sse', async (req, res) => {
    const server = createMcpServer();
    const transport = new SSEServerTransport('/messages', res);
    transport.onclose = () => {
      transports.delete(transport.sessionId);
    };
    transports.set(transport.sessionId, transport);
    await server.connect(transport);
  });

  app.post('/messages', async (req, res) => {
    const sessionId = req.query.sessionId;
    if (!sessionId) {
      return res.status(400).json({ error: 'Missing sessionId' });
    }
    const transport = transports.get(sessionId);
    if (!transport) {
      return res.status(404).json({ error: 'Session not found' });
    }
    await transport.handlePostMessage(req, res, null);
  });

  app.listen(PORT, () => {
    log('info', `MCP News Aggregator listening on port ${PORT}`);
  });
}

main().catch(console.error);