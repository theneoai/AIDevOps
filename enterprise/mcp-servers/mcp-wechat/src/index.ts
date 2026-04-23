import './tracer'; // must be first import — initializes OTel SDK before any other module
import express from 'express';
import { trace, SpanStatusCode } from '@opentelemetry/api';
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
import { initTokenStore, closeTokenStore } from './wechat/token-store';
import { CircuitBreaker } from './circuit-breaker';
import { PublishArticleParams, UploadImageParams } from './types/mcp';

const logger = createLogger(config.LOG_LEVEL);

// Circuit breaker protects against WeChat API outages
const wechatBreaker = new CircuitBreaker('wechat-api', {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  callTimeoutMs: 10_000,
});

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

  const tracer = trace.getTracer('mcp-wechat', '1.0.0');

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    logger.info('Tool called', { tool: name });

    return tracer.startActiveSpan(`tool.${name}`, async (span) => {
      span.setAttributes({
        'tool.name': name,
        'mcp.transport': 'sse',
        'tenant.id': process.env.TENANT_ID ?? 'default',
      });
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

        span.setStatus({ code: SpanStatusCode.OK });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Tool execution failed', { tool: name, error: errorMessage });
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ status: 'failed', error_message: errorMessage }, null, 2),
            },
          ],
          isError: true,
        };
      } finally {
        span.end();
      }
    });
  });

  return server;
}

async function handlePublishArticle(params: PublishArticleParams): Promise<Record<string, unknown>> {
  const token = await wechatBreaker.call(() => getAccessToken());
  logger.info('Publishing article', { title: params.title });
  return {
    status: 'success',
    message: 'Article draft created (placeholder)',
    title: params.title,
    token_preview: token.substring(0, 10) + '...',
  };
}

async function handleUploadImage(params: UploadImageParams): Promise<Record<string, unknown>> {
  const token = await wechatBreaker.call(() => getAccessToken());
  logger.info('Uploading image', { image_url: params.image_url, type: params.type });
  return {
    status: 'success',
    message: 'Image uploaded (placeholder)',
    image_url: params.image_url,
    token_preview: token.substring(0, 10) + '...',
  };
}

async function handleGetAccessToken(): Promise<Record<string, unknown>> {
  const token = await wechatBreaker.call(() => getAccessToken());
  return {
    status: 'success',
    access_token_preview: token.substring(0, 10) + '...',
    circuit_breaker_state: wechatBreaker.currentState,
    note: 'Full token available internally',
  };
}

const app = express();

// 关键：禁用 express.json() 对 /messages 路由的自动解析
// 因为 MCP SDK 的 handlePostMessage 需要自己读取原始 body
app.use(express.json({ 
  limit: '4mb',
  // 不对 /messages 路由使用 express.json()
  type: (req) => {
    if (req.url?.startsWith('/messages')) {
      return false;
    }
    return req.headers['content-type']?.includes('application/json') || false;
  }
}));

const transports: Map<string, SSEServerTransport> = new Map();

// SSE endpoint - 使用 Server-Sent Events 协议
app.get(config.MCP_SERVER_PATH, async (req, res) => {
  logger.info('New SSE connection', { path: config.MCP_SERVER_PATH });

  try {
    // 创建 SSE 传输层，它会自动设置响应头
    const transport = new SSEServerTransport('/messages', res);
    const sessionId = transport.sessionId;
    
    logger.info('SSE transport created', { sessionId });

    // 创建 MCP 服务器并连接
    const server = createMcpServer();
    await server.connect(transport);

    logger.info('MCP server connected', { sessionId });

    // 保存 transport 以便后续消息路由
    transports.set(sessionId, transport);

    // 监听连接关闭
    transport.onclose = () => {
      logger.info('SSE connection closed', { sessionId });
      transports.delete(sessionId);
    };

    // 监听错误
    transport.onerror = (error) => {
      logger.error('SSE transport error', { sessionId, error: error.message });
      transports.delete(sessionId);
    };

    // 监听客户端断开连接
    req.on('close', () => {
      logger.info('Client disconnected', { sessionId });
      transports.delete(sessionId);
    });

  } catch (error) {
    logger.error('Error setting up SSE', { error: (error as Error).message });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to setup SSE' });
    }
  }
});

// Messages endpoint - 处理客户端发来的 JSON-RPC 消息
app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId as string;
  
  logger.debug('Received message', { sessionId });

  const transport = transports.get(sessionId);

  if (!transport) {
    logger.warn('No transport found for session', { sessionId });
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  try {
    // 使用 transport 处理消息 - 让它自己读取原始 body
    await transport.handlePostMessage(req, res);
  } catch (error) {
    logger.error('Error handling message', { sessionId, error: (error as Error).message });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
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
  if (!res.headersSent) {
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Initialize Redis-backed token store before accepting requests
initTokenStore().catch((err) =>
  logger.error('Token store init failed — falling back to disk cache', { error: String(err) }),
);

const httpServer = app.listen(config.MCP_SERVER_PORT, () => {
  logger.info(`MCP Server running on port ${config.MCP_SERVER_PORT}`, {
    path: config.MCP_SERVER_PATH,
    port: config.MCP_SERVER_PORT,
  });
});

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down gracefully`);
  await closeTokenStore();
  httpServer.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
