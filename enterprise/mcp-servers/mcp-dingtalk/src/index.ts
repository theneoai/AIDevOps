import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { config } from './config';
import { DingTalkClient } from './dingtalk-client';

const app = express();
app.use(express.json());

const dingtalk = new DingTalkClient();
const transports = new Map<string, SSEServerTransport>();

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'mcp-dingtalk',
    version: '1.0.0',
  });

  server.tool(
    'send_work_notification',
    'Send a work notification to specific DingTalk users',
    {
      user_ids: z.array(z.string()).describe('List of DingTalk user IDs to notify'),
      title: z.string().describe('Notification title'),
      content: z.string().describe('Notification content (supports Markdown)'),
    },
    async ({ user_ids, title, content }) => {
      const taskId = await dingtalk.sendWorkNotification(user_ids, title, content);
      return { content: [{ type: 'text', text: `Notification sent. task_id: ${taskId}` }] };
    },
  );

  server.tool(
    'send_group_message',
    'Send a message to a DingTalk group chat',
    {
      chat_id: z.string().describe('DingTalk group chat ID'),
      title: z.string().describe('Message title'),
      content: z.string().describe('Message content (supports Markdown)'),
    },
    async ({ chat_id, title, content }) => {
      await dingtalk.sendGroupMessage(chat_id, title, content);
      return { content: [{ type: 'text', text: `Group message sent to ${chat_id}` }] };
    },
  );

  server.tool(
    'send_robot_webhook',
    'Send a message via a DingTalk custom robot webhook URL',
    {
      webhook_url: z.string().url().describe('DingTalk robot webhook URL'),
      title: z.string().describe('Message title'),
      content: z.string().describe('Message content (supports Markdown)'),
    },
    async ({ webhook_url, title, content }) => {
      await dingtalk.sendRobotWebhook(webhook_url, title, content);
      return { content: [{ type: 'text', text: `Webhook message sent successfully` }] };
    },
  );

  server.tool(
    'get_user_info',
    'Get DingTalk user information by user ID',
    {
      user_id: z.string().describe('DingTalk user ID'),
    },
    async ({ user_id }) => {
      const info = await dingtalk.getUserInfo(user_id);
      return { content: [{ type: 'text', text: JSON.stringify(info) }] };
    },
  );

  return server;
}

app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  transports.set(transport.sessionId, transport);
  const server = createMcpServer();
  await server.connect(transport);
  transport.onclose = () => transports.delete(transport.sessionId);
});

app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  await transport.handlePostMessage(req, res);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'mcp-dingtalk', timestamp: new Date().toISOString() });
});

app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send([
    `# HELP mcp_dingtalk_active_sessions Number of active MCP sessions`,
    `# TYPE mcp_dingtalk_active_sessions gauge`,
    `mcp_dingtalk_active_sessions ${transports.size}`,
  ].join('\n'));
});

const httpServer = app.listen(config.port, () => {
  console.log(`[mcp-dingtalk] Listening on port ${config.port}`);
});

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  httpServer.close(() => process.exit(0));
});
