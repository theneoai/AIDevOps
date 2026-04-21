import axios, { AxiosError } from 'axios';
import { DifyApiAdapter } from '../src/adapters/dify-api-adapter';
import { DifyApiNotAvailableError, DifyVersionMismatchError } from '../src/adapters/dify-adapter.interface';
import { ToolDSL } from '../src/types/dsl';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const mockApiDSL: ToolDSL = {
  apiVersion: 'dify.enterprise/v1',
  kind: 'Tool',
  metadata: { name: 'test-tool', description: 'Test tool' },
  spec: {
    type: 'api',
    server: 'http://test-service:3000',
    endpoints: [
      {
        operationId: 'doSomething',
        method: 'POST',
        path: '/do',
        summary: 'Do something',
        inputs: [{ name: 'param1', type: 'string', required: true }],
      },
    ],
  },
};

const mockMcpDSL: ToolDSL = {
  apiVersion: 'dify.enterprise/v1',
  kind: 'Tool',
  metadata: { name: 'test-mcp', description: 'Test MCP tool' },
  spec: {
    type: 'mcp',
    server: 'http://mcp-service:3000/sse',
    tools: [{ name: 'run', description: 'Run something', inputs: [] }],
  },
};

describe('DifyApiAdapter', () => {
  let adapter: DifyApiAdapter;
  let mockClient: { get: jest.Mock; post: jest.Mock; delete: jest.Mock };

  beforeEach(() => {
    mockClient = {
      get: jest.fn(),
      post: jest.fn(),
      delete: jest.fn(),
    };
    mockedAxios.create = jest.fn().mockReturnValue(mockClient);
    adapter = new DifyApiAdapter('http://localhost/v1', 'test-api-key');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('connect()', () => {
    it('calls GET /v1/info to validate the API key', async () => {
      mockClient.get.mockResolvedValueOnce({ data: { version: '0.15.0' } });
      await adapter.connect();
      expect(mockClient.get).toHaveBeenCalledWith('/v1/info');
    });

    it('throws when the API key is invalid', async () => {
      mockClient.get.mockRejectedValueOnce(new Error('401 Unauthorized'));
      await expect(adapter.connect()).rejects.toThrow('401 Unauthorized');
    });
  });

  describe('registerTool()', () => {
    it('posts to the API tool endpoint for type=api', async () => {
      mockClient.post.mockResolvedValueOnce({
        status: 201,
        data: { id: 'provider-123' },
      });
      const result = await adapter.registerTool(mockApiDSL);
      expect(mockClient.post).toHaveBeenCalledWith(
        '/v1/workspaces/current/tool-providers/api',
        mockApiDSL
      );
      expect(result).toMatchObject({
        success: true,
        providerId: 'provider-123',
        providerType: 'api',
        action: 'created',
      });
    });

    it('posts to the MCP tool endpoint for type=mcp', async () => {
      mockClient.post.mockResolvedValueOnce({
        status: 200,
        data: { id: 'mcp-456' },
      });
      const result = await adapter.registerTool(mockMcpDSL);
      expect(mockClient.post).toHaveBeenCalledWith(
        '/v1/workspaces/current/tool-providers/mcp',
        mockMcpDSL
      );
      expect(result).toMatchObject({
        success: true,
        providerId: 'mcp-456',
        providerType: 'mcp',
        action: 'updated',
      });
    });

    it('propagates HTTP errors', async () => {
      mockClient.post.mockRejectedValueOnce(new Error('500 Internal Server Error'));
      await expect(adapter.registerTool(mockApiDSL)).rejects.toThrow('500 Internal Server Error');
    });
  });

  describe('listProviders()', () => {
    it('returns mapped ProviderStatus array', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: {
          data: [
            { id: 'p1', name: 'tool-a', type: 'api', updated_at: '2026-01-01T00:00:00Z' },
            { id: 'p2', name: 'tool-b', type: 'mcp', updated_at: '2026-01-02T00:00:00Z' },
          ],
        },
      });
      const providers = await adapter.listProviders();
      expect(providers).toHaveLength(2);
      expect(providers[0]).toMatchObject({ id: 'p1', name: 'tool-a', type: 'api' });
      expect(providers[1]).toMatchObject({ id: 'p2', name: 'tool-b', type: 'mcp' });
      expect(providers[0].updatedAt).toBeInstanceOf(Date);
    });

    it('passes tenantId as query param when provided', async () => {
      mockClient.get.mockResolvedValueOnce({ data: { data: [] } });
      await adapter.listProviders('tenant-abc');
      expect(mockClient.get).toHaveBeenCalledWith(
        '/v1/workspaces/current/tool-providers',
        { params: { tenant_id: 'tenant-abc' } }
      );
    });
  });

  describe('deleteProvider()', () => {
    it('sends DELETE to the correct endpoint', async () => {
      mockClient.delete.mockResolvedValueOnce({ status: 204 });
      await adapter.deleteProvider('provider-xyz');
      expect(mockClient.delete).toHaveBeenCalledWith(
        '/v1/workspaces/current/tool-providers/provider-xyz'
      );
    });
  });

  describe('disconnect()', () => {
    it('resolves without error (no-op for HTTP client)', async () => {
      await expect(adapter.disconnect()).resolves.toBeUndefined();
    });
  });

  // ── Version bounds ────────────────────────────────────────────

  describe('connect() — version bounds', () => {
    it('succeeds when connected version is within bounds', async () => {
      const bounded = new DifyApiAdapter('http://localhost/v1', 'key', undefined, {
        minVersion: '1.13.0',
        maxVersion: '1.14.x',
      });
      // @ts-expect-error accessing private client
      bounded['client'] = mockClient;
      mockClient.get.mockResolvedValueOnce({ data: { version: '1.13.3' } });
      await expect(bounded.connect()).resolves.toBeUndefined();
    });

    it('throws DifyVersionMismatchError when version is below minVersion', async () => {
      const bounded = new DifyApiAdapter('http://localhost/v1', 'key', undefined, {
        minVersion: '1.13.0',
      });
      // @ts-expect-error accessing private client
      bounded['client'] = mockClient;
      mockClient.get.mockResolvedValueOnce({ data: { version: '1.12.5' } });
      await expect(bounded.connect()).rejects.toThrow(DifyVersionMismatchError);
    });

    it('throws DifyVersionMismatchError when version exceeds maxVersion', async () => {
      const bounded = new DifyApiAdapter('http://localhost/v1', 'key', undefined, {
        maxVersion: '1.14.x',
      });
      // @ts-expect-error accessing private client
      bounded['client'] = mockClient;
      mockClient.get.mockResolvedValueOnce({ data: { version: '1.15.0' } });
      await expect(bounded.connect()).rejects.toThrow(DifyVersionMismatchError);
    });
  });

  // ── runWorkflow ────────────────────────────────────────────────

  describe('runWorkflow()', () => {
    it('uses the adapter api key by default (no Authorization override)', async () => {
      mockClient.post.mockResolvedValueOnce({
        status: 200,
        data: { task_id: 't1', workflow_run_id: 'wr1', data: { status: 'succeeded', outputs: {} } },
      });
      await adapter.runWorkflow({ inputs: { q: 'test' }, userId: 'user1' });
      // Should NOT pass a per-request Authorization header override
      const call = mockClient.post.mock.calls[0];
      expect(call[2]).toBeUndefined();
    });

    it('overrides Authorization when appApiKey is provided', async () => {
      mockClient.post.mockResolvedValueOnce({
        status: 200,
        data: { task_id: 't2', workflow_run_id: 'wr2', data: { status: 'running' } },
      });
      await adapter.runWorkflow({
        inputs: {},
        userId: 'user1',
        appApiKey: 'app-specific-key-xyz',
      });
      const call = mockClient.post.mock.calls[0];
      expect(call[2]).toMatchObject({ headers: { Authorization: 'Bearer app-specific-key-xyz' } });
    });

    it('maps response fields correctly', async () => {
      mockClient.post.mockResolvedValueOnce({
        status: 200,
        data: {
          task_id: 'task-abc',
          workflow_run_id: 'run-def',
          data: { status: 'succeeded', outputs: { result: 'hello' } },
        },
      });
      const result = await adapter.runWorkflow({ inputs: {}, userId: 'u' });
      expect(result).toMatchObject({
        taskId: 'task-abc',
        workflowRunId: 'run-def',
        status: 'succeeded',
        outputs: { result: 'hello' },
      });
    });
  });

  // ── Experimental methods ──────────────────────────────────────

  describe('configureMcpExport() — @experimental', () => {
    it('throws DifyApiNotAvailableError when Dify returns 404', async () => {
      const notFound = new AxiosError('Not Found');
      Object.assign(notFound, { response: { status: 404 } });
      mockClient.post.mockRejectedValueOnce(notFound);
      await expect(
        adapter.configureMcpExport('app-id', { enabled: true }),
      ).rejects.toThrow(DifyApiNotAvailableError);
    });
  });

  describe('installPlugin() — @experimental', () => {
    it('throws DifyApiNotAvailableError when Dify returns 404', async () => {
      const notFound = new AxiosError('Not Found');
      Object.assign(notFound, { response: { status: 404 } });
      mockClient.post.mockRejectedValueOnce(notFound);
      const dsl = {
        apiVersion: 'dify.enterprise/v1',
        kind: 'Plugin' as const,
        metadata: { name: 'test-plugin' },
        spec: { source: 'marketplace' as const, pluginId: 'vendor/plugin', version: '1.0.0' },
      };
      await expect(adapter.installPlugin(dsl)).rejects.toThrow(DifyApiNotAvailableError);
    });
  });

  describe('getMcpServerInfo() — @experimental', () => {
    it('returns null when Dify returns 404 (graceful degradation)', async () => {
      const notFound = new AxiosError('Not Found');
      Object.assign(notFound, { response: { status: 404 } });
      mockClient.get.mockRejectedValueOnce(notFound);
      const result = await adapter.getMcpServerInfo('app-id');
      expect(result).toBeNull();
    });
  });
});
