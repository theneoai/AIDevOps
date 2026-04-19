import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { config } from './config';
import { createLogger } from './logger';
import { getAccessToken } from './wechat/auth';
import { PublishArticleParams, UploadImageParams } from './types/mcp';

const logger = createLogger(config.LOG_LEVEL);

const tools: Tool[] = [
  {
    name: 'publish_article',
    description: '发布一篇微信公众号图文文章（创建草稿）',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '文章标题' },
        content: { type: 'string', description: '文章正文（支持 HTML 格式）' },
        thumb_media_id: { type: 'string', description: '封面图片的 media_id' },
        author: { type: 'string', description: '作者名' },
        digest: { type: 'string', description: '文章摘要' },
        content_source_url: { type: 'string', description: '原文链接' },
        need_open_comment: { type: 'boolean', description: '是否打开评论' },
        only_fans_can_comment: { type: 'boolean', description: '是否仅粉丝可评论' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'upload_image',
    description: '上传图片到微信素材库',
    inputSchema: {
      type: 'object',
      properties: {
        image_url: { type: 'string', description: '图片的 URL 地址' },
        type: { type: 'string', enum: ['thumb', 'content'], description: '图片类型' },
      },
      required: ['image_url'],
    },
  },
  {
    name: 'get_access_token',
    description: '获取当前有效的 access_token（调试用）',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

function createMcpServer(): Server {
  const server = new Server(
    {
      name: 'dify-mcp-wechat',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.debug('Listing tools');
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    logger.info('Tool called', { tool: name });

    try {
      let result: Record<string, unknown> | unknown;

      switch (name) {
        case 'publish_article':
          result = await handlePublishArticle(args as unknown as PublishArticleParams);
          break;
        case 'upload_image':
          result = await handleUploadImage(args as unknown as UploadImageParams);
          break;
        case 'get_access_token':
          result = await handleGetAccessToken();
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Tool execution failed', { tool: name, error: errorMessage });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ status: 'failed', error_message: errorMessage }, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

async function handlePublishArticle(params: PublishArticleParams): Promise<Record<string, unknown>> {
  const token = await getAccessToken();
  logger.info('Publishing article', { title: params.title });
  // TODO: Implement actual WeChat API call
  return {
    status: 'success',
    message: 'Article draft created (placeholder)',
    title: params.title,
    token_preview: token.substring(0, 10) + '...',
  };
}

async function handleUploadImage(params: UploadImageParams): Promise<Record<string, unknown>> {
  const token = await getAccessToken();
  logger.info('Uploading image', { image_url: params.image_url, type: params.type });
  // TODO: Implement actual WeChat API call
  return {
    status: 'success',
    message: 'Image uploaded (placeholder)',
    image_url: params.image_url,
    token_preview: token.substring(0, 10) + '...',
  };
}

async function handleGetAccessToken(): Promise<Record<string, unknown>> {
  const token = await getAccessToken();
  return {
    status: 'success',
    access_token_preview: token.substring(0, 10) + '...',
    note: 'Full token available internally',
  };
}

const app = express();
app.use(express.json());

const transports: Map<string, SSEServerTransport> = new Map();

app.get(config.MCP_SERVER_PATH, async (req, res) => {
  logger.info('New SSE connection', { path: config.MCP_SERVER_PATH });

  const transport = new SSEServerTransport('/messages', res);
  const sessionId = transport.sessionId;
  transports.set(sessionId, transport);

  const server = createMcpServer();
  await server.connect(transport);

  transport.onclose = () => {
    logger.info('SSE connection closed', { sessionId });
    transports.delete(sessionId);
  };

  transport.onerror = (error) => {
    logger.error('SSE transport error', { sessionId, error: error.message });
    transports.delete(sessionId);
  };
});

app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);

  if (!transport) {
    logger.warn('No transport found for session', { sessionId });
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  await transport.handlePostMessage(req, res);
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'dify-mcp-wechat',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ status: 'error', message: 'Internal server error' });
});

const httpServer = app.listen(config.MCP_SERVER_PORT, () => {
  logger.info(`MCP Server running on port ${config.MCP_SERVER_PORT}`, {
    path: config.MCP_SERVER_PATH,
    port: config.MCP_SERVER_PORT,
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  httpServer.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  httpServer.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});
