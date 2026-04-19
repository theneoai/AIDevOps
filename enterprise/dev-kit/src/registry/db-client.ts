/**
 * Dify Database Client
 *
 * Handles direct PostgreSQL operations for registering tools
 * in Dify's database tables (tool_api_providers, tool_mcp_providers).
 */

import { Pool, PoolClient } from 'pg';
import { DifyDatabaseConfig } from '../core/config';
import { DifyApiToolProvider, DifyMCPToolProvider } from '../types/dify';
import { encryptServerUrl, sha256 } from './crypto';

// ─────────────────────────────────────────────────────────────
// Database Client
// ─────────────────────────────────────────────────────────────

export interface TenantInfo {
  id: string;
  encryptPublicKey: string | null;
}

export interface UserInfo {
  id: string;
}

export class DifyDbClient {
  private pool: Pool;

  constructor(config: DifyDatabaseConfig) {
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
    });
  }

  async connect(): Promise<void> {
    const client = await this.pool.connect();
    client.release();
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }

  // ─────────────────────────────────────────────────────────────
  // Tenant & User Lookup
  // ─────────────────────────────────────────────────────────────

  async getDefaultTenant(): Promise<TenantInfo> {
    const result = await this.pool.query(
      'SELECT id, encrypt_public_key FROM tenants LIMIT 1'
    );
    if (result.rows.length === 0) {
      throw new Error('No tenant found in database');
    }
    return {
      id: result.rows[0].id,
      encryptPublicKey: result.rows[0].encrypt_public_key,
    };
  }

  async getDefaultUser(): Promise<UserInfo> {
    const result = await this.pool.query('SELECT id FROM accounts LIMIT 1');
    if (result.rows.length === 0) {
      throw new Error('No user found in database');
    }
    return { id: result.rows[0].id };
  }

  // ─────────────────────────────────────────────────────────────
  // API Tool Provider Registration
  // ─────────────────────────────────────────────────────────────

  async registerApiToolProvider(
    provider: DifyApiToolProvider,
    toolsStr: string,
    userId?: string
  ): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Check if exists
      const existing = await client.query(
        'SELECT id FROM tool_api_providers WHERE name = $1 AND tenant_id = $2',
        [provider.name, provider.tenant_id]
      );

      if (existing.rows.length > 0) {
        // Update
        const id = existing.rows[0].id;
        await client.query(
          `UPDATE tool_api_providers
           SET schema = $1, schema_type_str = $2, tools_str = $3, credentials_str = $4,
               description = $5, icon = $6, updated_at = NOW()
           WHERE id = $7`,
          [
            provider.schema,
            provider.schema_type || 'openapi',
            toolsStr,
            provider.credentials || '{}',
            provider.description || '',
            provider.icon || '',
            id,
          ]
        );
        await client.query('COMMIT');
        return id;
      }

      // Insert new
      await client.query(
        `INSERT INTO tool_api_providers
         (id, tenant_id, name, icon, schema, schema_type_str, credentials_str,
          description, tools_str, privacy_policy, custom_disclaimer, user_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())`,
        [
          provider.id,
          provider.tenant_id,
          provider.name,
          provider.icon || '',
          provider.schema,
          provider.schema_type || 'openapi',
          provider.credentials || '{}',
          provider.description || '',
          toolsStr,
          provider.privacy_policy || '',
          provider.custom_disclaimer || '',
          userId || provider.id,
        ]
      );

      await client.query('COMMIT');
      return provider.id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ─────────────────────────────────────────────────────────────
  // MCP Tool Provider Registration
  // ─────────────────────────────────────────────────────────────

  async registerMcpToolProvider(
    provider: DifyMCPToolProvider,
    serverUrl: string,
    tools: Array<{
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
    }>,
    encryptPublicKey?: string | null
  ): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const serverUrlHash = sha256(serverUrl);
      const identifier = provider.name;

      // Encrypt server_url
      let encryptedServerUrl: string;
      if (encryptPublicKey) {
        try {
          encryptedServerUrl = encryptServerUrl(serverUrl, encryptPublicKey);
        } catch (e) {
          console.warn(`Encryption failed, falling back to plaintext: ${e}`);
          encryptedServerUrl = serverUrl;
        }
      } else {
        encryptedServerUrl = serverUrl;
      }

      // Check if exists
      const existing = await client.query(
        'SELECT id FROM tool_mcp_providers WHERE server_identifier = $1 AND tenant_id = $2',
        [identifier, provider.tenant_id]
      );

      if (existing.rows.length > 0) {
        // Update
        const id = existing.rows[0].id;
        await client.query(
          `UPDATE tool_mcp_providers
           SET tools = $1, server_url = $2, server_url_hash = $3, icon = $4,
               name = $5, updated_at = NOW()
           WHERE id = $6`,
          [
            JSON.stringify(tools),
            encryptedServerUrl,
            serverUrlHash,
            provider.icon || '',
            provider.name,
            id,
          ]
        );
        await client.query('COMMIT');
        return id;
      }

      // Insert new
      await client.query(
        `INSERT INTO tool_mcp_providers
         (id, tenant_id, user_id, name, server_identifier, server_url, server_url_hash,
          tools, authed, icon, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
        [
          provider.id,
          provider.tenant_id,
          provider.id, // user_id
          provider.name,
          identifier,
          encryptedServerUrl,
          serverUrlHash,
          JSON.stringify(tools),
          false, // authed
          provider.icon || '',
        ]
      );

      await client.query('COMMIT');
      return provider.id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Status Queries
  // ─────────────────────────────────────────────────────────────

  async listApiProviders(tenantId: string): Promise<Array<{ id: string; name: string; updated_at: Date }>> {
    const result = await this.pool.query(
      'SELECT id, name, updated_at FROM tool_api_providers WHERE tenant_id = $1 ORDER BY updated_at DESC',
      [tenantId]
    );
    return result.rows;
  }

  async listMcpProviders(tenantId: string): Promise<Array<{ id: string; name: string; updated_at: Date }>> {
    const result = await this.pool.query(
      'SELECT id, name, updated_at FROM tool_mcp_providers WHERE tenant_id = $1 ORDER BY updated_at DESC',
      [tenantId]
    );
    return result.rows;
  }
}
