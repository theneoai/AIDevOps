/**
 * Integration tests for the enterprise tool-service REST API.
 *
 * These tests run against a live staging Dify + tool-service stack.
 * Required env vars:
 *   DIFY_BASE_URL  — e.g. https://staging.dify.internal
 *   DIFY_API_KEY   — staging API key
 *
 * When the env vars are absent (local dev / unit-test runs) every test
 * is skipped automatically so the suite never blocks offline workflows.
 */

import axios from 'axios';

const BASE_URL = process.env.DIFY_BASE_URL;
const API_KEY = process.env.DIFY_API_KEY;
const TOOL_SERVICE_URL = process.env.TOOL_SERVICE_URL ?? 'http://localhost:3100';

const integrationEnabled = Boolean(BASE_URL && API_KEY);

const maybeDescribe = integrationEnabled ? describe : describe.skip;

maybeDescribe('Tool Service — integration', () => {
  const client = axios.create({
    baseURL: TOOL_SERVICE_URL,
    headers: { Authorization: `Bearer ${API_KEY}` },
    validateStatus: () => true,
  });

  test('GET /health returns 200 with status ok', async () => {
    const res = await client.get('/health');
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('ok');
  });

  test('GET /tools returns 200 with tools array', async () => {
    const res = await client.get('/tools');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
  });

  test('POST /tools/invoke rejects missing tool name with 400', async () => {
    const res = await client.post('/tools/invoke', {});
    expect(res.status).toBe(400);
  });

  test('unauthenticated request returns 401', async () => {
    const unauthClient = axios.create({
      baseURL: TOOL_SERVICE_URL,
      validateStatus: () => true,
    });
    const res = await unauthClient.get('/tools');
    expect(res.status).toBe(401);
  });
});

maybeDescribe('Dify API Adapter — integration', () => {
  const difyClient = axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${API_KEY}` },
    validateStatus: () => true,
  });

  test('Dify API is reachable', async () => {
    const res = await difyClient.get('/info');
    expect([200, 401, 403]).toContain(res.status);
  });

  test('listing apps returns 200 with valid shape', async () => {
    const res = await difyClient.get('/apps', { params: { page: 1, limit: 5 } });
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('data');
  });
});
