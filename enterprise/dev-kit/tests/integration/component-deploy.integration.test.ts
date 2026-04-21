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
  let deployedProviderId: string;

  beforeAll(() => {
    adapter = new DifyApiAdapter(BASE_URL!, API_KEY!);
  });

  test('registerTool creates tool provider', async () => {
    const result = await adapter.registerTool(testTool);
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('providerId');
    deployedProviderId = result.providerId;
  });

  test('listProviders returns deployed tool', async () => {
    const providers = await adapter.listProviders();
    const deployed = providers.find((p) => p.name === testTool.metadata.name);
    expect(deployed).toBeDefined();
  });

  test('deleteProvider removes deployed tool', async () => {
    await expect(adapter.deleteProvider(deployedProviderId)).resolves.not.toThrow();
  });

  test('tool is absent after deletion', async () => {
    const providers = await adapter.listProviders();
    const deployed = providers.find((p) => p.name === testTool.metadata.name);
    expect(deployed).toBeUndefined();
  });
});
