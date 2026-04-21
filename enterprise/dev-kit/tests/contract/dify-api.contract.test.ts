import axios from 'axios';

/**
 * Contract tests: verify Dify REST API response shapes match what DifyApiAdapter expects.
 * Run BEFORE any Dify upgrade to catch breaking changes early.
 *
 * Requires DIFY_BASE_URL + DIFY_API_KEY. Skipped automatically when absent.
 * For workflow tests, also requires DIFY_WORKFLOW_APP_API_KEY (per-app key).
 *
 * NOTE: Tests marked @experimental require a Dify instance with the feature enabled.
 * If they fail with 404, the feature is not yet available in that Dify version.
 */
const SKIP = !process.env.DIFY_BASE_URL || !process.env.DIFY_API_KEY;
const SKIP_WORKFLOW = SKIP || !process.env.DIFY_WORKFLOW_APP_API_KEY;

if (SKIP) {
  console.warn(
    '[contract] DIFY_BASE_URL or DIFY_API_KEY not set — contract tests skipped. ' +
    'Set these env vars and run before any Dify upgrade.',
  );
}

const client = axios.create({
  baseURL: process.env.DIFY_BASE_URL ?? 'http://localhost/v1',
  headers: { Authorization: `Bearer ${process.env.DIFY_API_KEY ?? ''}` },
  timeout: 10_000,
});

describe('Dify REST API Contract', () => {
  const skip = (name: string, fn: () => Promise<void>) =>
    SKIP ? it.skip(name, fn) : it(name, fn);
  const skipWorkflow = (name: string, fn: () => Promise<void>) =>
    SKIP_WORKFLOW ? it.skip(name, fn) : it(name, fn);

  // ── STABLE endpoints ──────────────────────────────────────────

  describe('GET /v1/info (STABLE)', () => {
    skip('returns version string', async () => {
      const response = await client.get('/v1/info');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('version');
      // Version must be a semver-like string
      expect(typeof response.data.version).toBe('string');
      expect(response.data.version).toMatch(/^\d+\.\d+/);
    });
  });

  describe('GET /v1/workspaces/current/tool-providers (STABLE)', () => {
    skip('returns paginated data array with required fields', async () => {
      const response = await client.get('/v1/workspaces/current/tool-providers');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('data');
      expect(Array.isArray(response.data.data)).toBe(true);

      if (response.data.data.length > 0) {
        const first = response.data.data[0];
        // These fields are read by DifyApiAdapter.listProviders() — any rename is a breaking change
        expect(first).toHaveProperty('id');
        expect(first).toHaveProperty('name');
        expect(first).toHaveProperty('type');
        expect(first).toHaveProperty('updated_at');
      }
    });
  });

  // ── Workflow execution (STABLE service API) ───────────────────
  // Auth note: uses per-app API key, NOT the workspace admin key.

  describe('POST /v1/workflows/run (STABLE — per-app API key required)', () => {
    skipWorkflow('returns task_id and workflow_run_id on blocking run', async () => {
      const workflowClient = axios.create({
        baseURL: process.env.DIFY_BASE_URL,
        headers: { Authorization: `Bearer ${process.env.DIFY_WORKFLOW_APP_API_KEY}` },
        timeout: 30_000,
      });
      const response = await workflowClient.post('/v1/workflows/run', {
        inputs: {},
        response_mode: 'blocking',
        user: 'contract-test',
      });
      // 200 or 202 are both valid for blocking mode
      expect([200, 202]).toContain(response.status);
      // DifyApiAdapter.runWorkflow() reads these fields
      expect(response.data).toHaveProperty('task_id');
      expect(response.data).toHaveProperty('workflow_run_id');
    });
  });

  // ── EXPERIMENTAL endpoints ────────────────────────────────────
  // These tests document EXPECTED future behaviour.
  // A 404 response means the feature is not yet in this Dify version — that is OK.

  describe('@experimental GET /v1/apps/:id/mcp', () => {
    skip('returns 200 or 404 (feature not yet available)', async () => {
      try {
        const response = await client.get('/v1/apps/test-app-id/mcp');
        // If it exists, it must have an endpoint_url field
        if (response.status === 200) {
          expect(response.data).toHaveProperty('endpoint_url');
        }
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404) {
          // Expected — MCP export not yet a native REST API in this Dify version
          return;
        }
        throw err;
      }
    });
  });

  describe('@experimental GET /v1/workspaces/current/plugins', () => {
    skip('returns 200 or 404 (feature not yet available)', async () => {
      try {
        const response = await client.get('/v1/workspaces/current/plugins');
        if (response.status === 200) {
          expect(response.data).toHaveProperty('data');
        }
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404) {
          return;
        }
        throw err;
      }
    });
  });
});
