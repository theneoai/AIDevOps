import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { config } from './config';
import { IMClient } from './im-client';

const app = express();
app.use(express.json());

const im = new IMClient(config.imConfig);
const transports = new Map<string, SSEServerTransport>();

// ─────────────────────────────────────────────────────────────
// Metrics counters (in-memory, reset on restart)
// ─────────────────────────────────────────────────────────────
const metrics = {
  messagesSent: 0,
  notificationsSent: 0,
  errors: 0,
};

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'mcp-custom-im',
    version: '1.0.0',
  });

  // ── send_message ─────────────────────────────────────────
  server.tool(
    'send_message',
    'Send a text or markdown message to an IM channel. The backend is selected by routing rules.',
    {
      channel_id: z
        .string()
        .describe(
          'Target channel ID. Matched against routing rules to select the backend.',
        ),
      text: z.string().describe('Message body (plain text or Markdown)'),
      title: z
        .string()
        .optional()
        .describe('Optional title shown above the message (for rich message formats)'),
      format: z
        .enum(['text', 'markdown', 'html', 'card'])
        .optional()
        .default('text')
        .describe('Message format'),
    },
    async ({ channel_id, text, title, format }) => {
      try {
        const result = await im.sendMessage({ channelId: channel_id, text, title, format });
        metrics.messagesSent++;
        const mid = result.messageId ? ` (id: ${result.messageId})` : '';
        return {
          content: [
            {
              type: 'text',
              text: `Message sent to ${result.channelId} via ${result.backend}${mid}`,
            },
          ],
        };
      } catch (err) {
        metrics.errors++;
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
      }
    },
  );

  // ── send_notification ─────────────────────────────────────
  server.tool(
    'send_notification',
    'Send a structured notification with title, body, and severity level.',
    {
      title: z.string().describe('Notification title'),
      body: z.string().describe('Notification body text (supports Markdown)'),
      level: z
        .enum(['info', 'warning', 'error', 'success'])
        .optional()
        .default('info')
        .describe('Severity level — used for color coding / emoji prefix in supported backends'),
      recipients: z
        .array(z.string())
        .optional()
        .describe('List of user IDs or email addresses to notify (backend-specific)'),
      channel_id: z
        .string()
        .optional()
        .describe('Target channel (overrides routing rules)'),
    },
    async ({ title, body, level, recipients, channel_id }) => {
      try {
        const result = await im.sendNotification({
          title,
          body,
          level,
          recipients,
          channelId: channel_id,
        });
        metrics.notificationsSent++;
        return {
          content: [
            {
              type: 'text',
              text: `Notification "${title}" [${level}] sent via ${result.backend} to ${result.channelId}`,
            },
          ],
        };
      } catch (err) {
        metrics.errors++;
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
      }
    },
  );

  // ── send_rich_message ─────────────────────────────────────
  server.tool(
    'send_rich_message',
    'Send a rich card message with title, body, and key-value fields.',
    {
      channel_id: z.string().describe('Target channel ID'),
      title: z.string().describe('Card title'),
      body: z.string().describe('Card body text (supports Markdown)'),
      fields: z
        .record(z.string())
        .optional()
        .describe(
          'Key-value pairs rendered as structured fields in the card (e.g. {"Status": "Deployed", "Version": "1.2.0"})',
        ),
      format: z
        .enum(['markdown', 'card'])
        .optional()
        .default('markdown')
        .describe('Rendering format'),
    },
    async ({ channel_id, title, body, fields, format }) => {
      try {
        const result = await im.sendRichMessage({ channelId: channel_id, title, body, fields, format });
        metrics.messagesSent++;
        return {
          content: [
            {
              type: 'text',
              text: `Rich message "${title}" sent to ${result.channelId} via ${result.backend}`,
            },
          ],
        };
      } catch (err) {
        metrics.errors++;
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
      }
    },
  );

  // ── register_webhook ──────────────────────────────────────
  server.tool(
    'register_webhook',
    'Dynamically register a new webhook backend at runtime (without restarting the server).',
    {
      name: z.string().describe('Unique name for this webhook (used as channel_id to target it directly)'),
      url: z.string().url().describe('Webhook URL to POST messages to'),
      auth_type: z
        .enum(['none', 'bearer', 'api_key', 'hmac_sha256'])
        .optional()
        .default('none')
        .describe('Authentication type'),
      auth_value: z
        .string()
        .optional()
        .describe('Token or secret for the selected auth type'),
      body_template: z
        .string()
        .optional()
        .describe(
          'JSON string of a body template with {{text}}, {{title}}, {{level}}, {{channelId}} placeholders',
        ),
    },
    async ({ name, url, auth_type, auth_value, body_template }) => {
      try {
        const template = body_template ? JSON.parse(body_template) as Record<string, unknown> : undefined;
        im.registerWebhook(name, url, auth_type, auth_value, template);
        return {
          content: [
            {
              type: 'text',
              text: `Webhook "${name}" registered. Send to it with channel_id: "${name}"`,
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
      }
    },
  );

  // ── list_backends ─────────────────────────────────────────
  server.tool(
    'list_backends',
    'List all configured IM backends (static from config + dynamically registered webhooks).',
    {},
    async () => {
      const backends = im.listBackends();
      const lines = backends.map(
        (b) => `  ${b.name} [${b.type}]${b.dynamic ? ' (dynamic)' : ''}`,
      );
      return {
        content: [
          {
            type: 'text',
            text: `Configured backends (${backends.length}):\n${lines.join('\n')}`,
          },
        ],
      };
    },
  );

  return server;
}

// ─────────────────────────────────────────────────────────────
// HTTP Server
// ─────────────────────────────────────────────────────────────

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

app.get('/health', async (req, res) => {
  const backendHealth = await im.healthCheck();
  const allHealthy = Object.values(backendHealth).every(Boolean);
  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'ok' : 'degraded',
    service: 'mcp-custom-im',
    timestamp: new Date().toISOString(),
    backends: backendHealth,
  });
});

app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send(
    [
      `# HELP mcp_custom_im_active_sessions Number of active MCP sessions`,
      `# TYPE mcp_custom_im_active_sessions gauge`,
      `mcp_custom_im_active_sessions ${transports.size}`,
      ``,
      `# HELP mcp_custom_im_messages_sent_total Total messages sent`,
      `# TYPE mcp_custom_im_messages_sent_total counter`,
      `mcp_custom_im_messages_sent_total ${metrics.messagesSent}`,
      ``,
      `# HELP mcp_custom_im_notifications_sent_total Total notifications sent`,
      `# TYPE mcp_custom_im_notifications_sent_total counter`,
      `mcp_custom_im_notifications_sent_total ${metrics.notificationsSent}`,
      ``,
      `# HELP mcp_custom_im_errors_total Total errors`,
      `# TYPE mcp_custom_im_errors_total counter`,
      `mcp_custom_im_errors_total ${metrics.errors}`,
    ].join('\n'),
  );
});

// Runtime webhook registration endpoint (for non-MCP callers)
app.post('/webhooks/register', express.json(), (req, res) => {
  const { name, url, auth_type, auth_value } = req.body as {
    name: string;
    url: string;
    auth_type?: 'none' | 'bearer' | 'api_key' | 'hmac_sha256';
    auth_value?: string;
  };

  if (!name || !url) {
    res.status(400).json({ error: 'name and url are required' });
    return;
  }

  im.registerWebhook(name, url, auth_type ?? 'none', auth_value);
  res.json({ ok: true, message: `Webhook "${name}" registered` });
});

const httpServer = app.listen(config.port, () => {
  console.log(`[mcp-custom-im] Listening on port ${config.port}`);
  console.log(`[mcp-custom-im] Backends: ${im.listBackends().map((b) => b.name).join(', ')}`);
});

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  httpServer.close(() => process.exit(0));
});
