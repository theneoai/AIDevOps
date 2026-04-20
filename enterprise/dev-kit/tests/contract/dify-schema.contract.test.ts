import { Pool } from 'pg';

/**
 * Contract tests: verify Dify DB schema matches what DevKit expects.
 * Run before any Dify upgrade to catch breaking schema changes.
 * Requires a live Dify PostgreSQL instance (set via env vars).
 *
 * Skipped automatically when DIFY_DB_HOST is not set (e.g. unit-test CI runs).
 */
const SKIP = !process.env.DIFY_DB_HOST;

describe('Dify DB Schema Contract', () => {
  let pool: Pool;

  beforeAll(async () => {
    if (SKIP) return;
    pool = new Pool({
      host: process.env.DIFY_DB_HOST,
      port: Number(process.env.DIFY_DB_PORT ?? 5432),
      user: process.env.DIFY_DB_USER ?? 'postgres',
      password: process.env.DIFY_DB_PASSWORD,
      database: process.env.DIFY_DB_NAME ?? 'dify',
    });
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  const skip = (name: string, fn: () => Promise<void>) =>
    SKIP ? it.skip(name, fn) : it(name, fn);

  describe('tool_api_providers table', () => {
    skip('should have all required columns with correct types', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'tool_api_providers'
        ORDER BY ordinal_position
      `);
      const cols = Object.fromEntries(result.rows.map((r) => [r.column_name, r.data_type]));

      expect(cols['id']).toBe('uuid');
      expect(cols['tenant_id']).toBe('uuid');
      expect(cols['name']).toBe('character varying');
      expect(cols['schema_type_str']).toBe('character varying');
      expect(cols['tools_str']).toBe('text');
      expect(cols['credentials_str']).toBe('text');
    });
  });

  describe('tool_mcp_providers table', () => {
    skip('should have server_url_hash column (added in Dify 0.15.0)', async () => {
      const result = await pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'tool_mcp_providers'
        AND column_name = 'server_url_hash'
      `);
      // Failure here means DifyDbAdapter needs updating for the new Dify version
      expect(result.rows.length).toBe(1);
    });

    skip('should have authed column as boolean', async () => {
      const result = await pool.query(`
        SELECT data_type FROM information_schema.columns
        WHERE table_name = 'tool_mcp_providers'
        AND column_name = 'authed'
      `);
      expect(result.rows[0]?.data_type).toBe('boolean');
    });

    skip('should have all core columns', async () => {
      const result = await pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'tool_mcp_providers'
        ORDER BY ordinal_position
      `);
      const cols = result.rows.map((r) => r.column_name as string);
      for (const required of ['id', 'tenant_id', 'user_id', 'name', 'server_identifier', 'server_url', 'tools']) {
        expect(cols).toContain(required);
      }
    });
  });
});
