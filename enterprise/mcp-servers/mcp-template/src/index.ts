import express from 'express';
import { createMcpServer, SSEServerTransport } from './server';
import { createLogger } from './logger';
import { config } from './config';

const logger = createLogger('dify-mcp-template', config.LOG_LEVEL);
const app = express();

app.use(express.json());

const transports = new Map<string, SSEServerTransport>();

app.get(config.MCP_SERVER_PATH, async (req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  transports.set(transport.sessionId, transport);

  const server = createMcpServer();
  await server.connect(transport);

  logger.info('MCP client connected', { sessionId: transport.sessionId });

  transport.onclose = () => {
    transports.delete(transport.sessionId);
    logger.info('MCP client disconnected', { sessionId: transport.sessionId });
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
    service: 'dify-mcp-template',
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
