import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { config } from './config';
import { FeishuClient } from './feishu-client';

const app = express();
app.use(express.json());

const feishu = new FeishuClient();
const transports = new Map<string, SSEServerTransport>();

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'mcp-feishu',
    version: '1.0.0',
  });

  server.tool(
    'send_message',
    'Send a text message to a Feishu chat group or user',
    {
      chat_id: z.string().describe('Feishu chat_id of the target chat or user'),
      text: z.string().describe('Message text content'),
    },
    async ({ chat_id, text }) => {
      const messageId = await feishu.sendMessage(chat_id, text);
      return { content: [{ type: 'text', text: `Message sent. message_id: ${messageId}` }] };
    },
  );

  server.tool(
    'create_document',
    'Create a new Feishu Doc with the given title and content',
    {
      title: z.string().describe('Document title'),
      content: z.string().describe('Document body text'),
    },
    async ({ title, content }) => {
      const docToken = await feishu.createDocument(title, content);
      return { content: [{ type: 'text', text: `Document created. doc_token: ${docToken}` }] };
    },
  );

  server.tool(
    'update_document',
    'Update an existing Feishu Doc with new content',
    {
      doc_token: z.string().describe('Feishu document token'),
      content: z.string().describe('New content to write to the document'),
    },
    async ({ doc_token, content }) => {
      await feishu.updateDocument(doc_token, content);
      return { content: [{ type: 'text', text: `Document ${doc_token} updated successfully` }] };
    },
  );

  server.tool(
    'get_document_content',
    'Retrieve the raw text content of a Feishu Doc',
    {
      doc_token: z.string().describe('Feishu document token'),
    },
    async ({ doc_token }) => {
      const content = await feishu.getDocumentContent(doc_token);
      return { content: [{ type: 'text', text: content }] };
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
  res.json({ status: 'ok', service: 'mcp-feishu', timestamp: new Date().toISOString() });
});

app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send([
    `# HELP mcp_feishu_active_sessions Number of active MCP sessions`,
    `# TYPE mcp_feishu_active_sessions gauge`,
    `mcp_feishu_active_sessions ${transports.size}`,
  ].join('\n'));
});

const httpServer = app.listen(config.port, () => {
  console.log(`[mcp-feishu] Listening on port ${config.port}`);
});

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  httpServer.close(() => process.exit(0));
});
