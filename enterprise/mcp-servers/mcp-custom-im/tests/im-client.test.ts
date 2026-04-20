import axios from 'axios';
import { IMClient } from '../src/im-client';
import { IMConfig } from '../src/backends/types';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const mockPost = jest.fn().mockResolvedValue({ data: { id: 'msg-123' }, status: 200 });
const mockGet = jest.fn().mockRejectedValue({ response: { status: 405 } });

beforeEach(() => {
  jest.clearAllMocks();
  mockedAxios.create = jest.fn().mockReturnValue({
    post: mockPost,
    get: mockGet,
    request: mockPost,
  });
});

const baseConfig: IMConfig = {
  defaultBackend: 'test-webhook',
  backends: [
    {
      name: 'test-webhook',
      type: 'webhook',
      url: 'https://example.com/webhook',
      auth: { type: 'none' },
    },
  ],
};

describe('IMClient', () => {
  it('sends a plain text message via default backend', async () => {
    const client = new IMClient(baseConfig);
    const result = await client.sendMessage({ channelId: 'general', text: 'hello' });
    expect(result.success).toBe(true);
    expect(result.backend).toBe('test-webhook');
    expect(result.channelId).toBe('general');
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('sends a notification via default backend', async () => {
    const client = new IMClient(baseConfig);
    const result = await client.sendNotification({
      title: 'Deploy succeeded',
      body: 'v1.2.0 is live',
      level: 'success',
    });
    expect(result.success).toBe(true);
  });

  it('routes channelId matching glob to correct backend', async () => {
    const config: IMConfig = {
      defaultBackend: 'default',
      backends: [
        { name: 'default', type: 'webhook', url: 'https://example.com/default', auth: { type: 'none' } },
        { name: 'urgent', type: 'webhook', url: 'https://example.com/urgent', auth: { type: 'none' } },
      ],
      routes: [
        { pattern: 'urgent:*', backend: 'urgent' },
      ],
    };

    const client = new IMClient(config);
    const result = await client.sendMessage({ channelId: 'urgent:deploy', text: 'CRITICAL' });
    expect(result.backend).toBe('urgent');
  });

  it('falls back to default backend when no route matches', async () => {
    const config: IMConfig = {
      defaultBackend: 'default',
      backends: [
        { name: 'default', type: 'webhook', url: 'https://example.com/default', auth: { type: 'none' } },
        { name: 'special', type: 'webhook', url: 'https://example.com/special', auth: { type: 'none' } },
      ],
      routes: [{ pattern: 'special-*', backend: 'special' }],
    };

    const client = new IMClient(config);
    const result = await client.sendMessage({ channelId: 'general', text: 'hello' });
    expect(result.backend).toBe('default');
  });

  it('registers a dynamic webhook and routes to it by name', async () => {
    const client = new IMClient(baseConfig);
    client.registerWebhook('my-hook', 'https://example.com/my-hook', 'none');
    const result = await client.sendMessage({ channelId: 'my-hook', text: 'test' });
    expect(result.backend).toBe('my-hook');
  });

  it('lists static and dynamic backends', () => {
    const client = new IMClient(baseConfig);
    client.registerWebhook('dynamic-hook', 'https://x.com', 'none');
    const list = client.listBackends();
    expect(list.find((b) => b.name === 'test-webhook')?.dynamic).toBe(false);
    expect(list.find((b) => b.name === 'dynamic-hook')?.dynamic).toBe(true);
  });

  it('sends a rich message with fields', async () => {
    const client = new IMClient(baseConfig);
    const result = await client.sendRichMessage({
      channelId: 'ops',
      title: 'Deployment Report',
      body: 'All services healthy',
      fields: { Environment: 'production', Version: '2.1.0' },
      format: 'markdown',
    });
    expect(result.success).toBe(true);
  });
});

describe('WebhookBackend auth', () => {
  it('adds Bearer token header when auth.type=bearer', async () => {
    const config: IMConfig = {
      defaultBackend: 'bearer-backend',
      backends: [
        {
          name: 'bearer-backend',
          type: 'webhook',
          url: 'https://example.com/webhook',
          auth: { type: 'bearer', token: 'test-token-xyz' },
        },
      ],
    };
    const client = new IMClient(config);
    await client.sendMessage({ channelId: 'ch', text: 'hello' });
    const callArg = mockPost.mock.calls[0][0] as { headers?: Record<string, string> };
    expect(callArg.headers?.['Authorization']).toBe('Bearer test-token-xyz');
  });

  it('uses bodyTemplate with {{var}} substitution', async () => {
    const config: IMConfig = {
      defaultBackend: 'tmpl',
      backends: [
        {
          name: 'tmpl',
          type: 'webhook',
          url: 'https://example.com/webhook',
          auth: { type: 'none' },
          bodyTemplate: { content: '{{text}}', to: '{{channelId}}' },
        },
      ],
    };
    const client = new IMClient(config);
    await client.sendMessage({ channelId: 'team-ops', text: 'ping' });
    const callArg = mockPost.mock.calls[0][0] as { data?: Record<string, string> };
    expect(callArg.data?.['content']).toBe('ping');
    expect(callArg.data?.['to']).toBe('team-ops');
  });
});
