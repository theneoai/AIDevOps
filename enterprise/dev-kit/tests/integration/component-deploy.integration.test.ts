/**
 * Integration tests: component deploy round-trip via DifyApiAdapter.
 *
 * Skipped automatically when DIFY_BASE_URL / DIFY_API_KEY are absent.
 */

import { DifyApiAdapter } from '../../src/adapters/dify-api-adapter';
import { ToolDSL } from '../../src/types/dsl';

const BASE_URL = process.env.DIFY_BASE_URL;
const API_KEY = process.env.DIFY_API_KEY;

const integrationEnabled = Boolean(BASE_URL && API_KEY);
const maybeDescribe = integrationEnabled ? describe : describe.skip;

const testTool: ToolDSL = {
  apiVersion: 'dify.enterprise/v1',
  kind: 'Tool',
  metadata: { name: 'integration-test-tool', description: 'Temporary tool for integration testing' },
  spec: {
    type: 'api',
    server: 'http://enterprise-tool-service:3000',
    endpoints: [
      {
        operationId: 'ping',
        method: 'GET',
        path: '/health',
        summary: 'Ping health endpoint',
        inputs: [],
      },
    ],
  },
};

maybeDescribe('DifyApiAdapter — component deploy round-trip', () => {
  let adapter: DifyApiAdapter;

  beforeAll(() => {
    adapter = new DifyApiAdapter(BASE_URL!, API_KEY!);
  });

  test('deploy creates tool provider', async () => {
    const result = await adapter.deployTool(testTool);
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('name', testTool.metadata.name);
  });

  test('list returns deployed tool', async () => {
    const tools = await adapter.listTools();
    const deployed = tools.find((t) => t.name === testTool.metadata.name);
    expect(deployed).toBeDefined();
  });

  test('delete removes deployed tool', async () => {
    await expect(adapter.deleteTool(testTool.metadata.name)).resolves.not.toThrow();
  });

  test('tool is absent after deletion', async () => {
    const tools = await adapter.listTools();
    const deployed = tools.find((t) => t.name === testTool.metadata.name);
    expect(deployed).toBeUndefined();
  });
});
