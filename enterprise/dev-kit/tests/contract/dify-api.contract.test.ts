import axios from 'axios';

/**
 * Contract tests: verify Dify REST API response shapes match what DifyApiAdapter expects.
 * Run before any Dify upgrade. Requires DIFY_BASE_URL and DIFY_API_KEY env vars.
 *
 * Skipped automatically when DIFY_BASE_URL is not set.
 */
const SKIP = !process.env.DIFY_BASE_URL || !process.env.DIFY_API_KEY;

const client = axios.create({
  baseURL: process.env.DIFY_BASE_URL ?? 'http://localhost/v1',
  headers: { Authorization: `Bearer ${process.env.DIFY_API_KEY ?? ''}` },
  timeout: 10_000,
});

describe('Dify REST API Contract', () => {
  const skip = (name: string, fn: () => Promise<void>) =>
    SKIP ? it.skip(name, fn) : it(name, fn);

  describe('GET /v1/info', () => {
    skip('should return version and features', async () => {
      const response = await client.get('/v1/info');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('version');
    });
  });

  describe('GET /v1/workspaces/current/tool-providers', () => {
    skip('should return paginated data array', async () => {
      const response = await client.get('/v1/workspaces/current/tool-providers');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('data');
      expect(Array.isArray(response.data.data)).toBe(true);

      // If there are providers, verify the shape DifyApiAdapter.listProviders() depends on
      if (response.data.data.length > 0) {
        const first = response.data.data[0];
        expect(first).toHaveProperty('id');
        expect(first).toHaveProperty('name');
        expect(first).toHaveProperty('type');
        expect(first).toHaveProperty('updated_at');
      }
    });
  });
});
