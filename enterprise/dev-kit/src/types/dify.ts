/**
 * Dify Internal Type Definitions
 *
 * Mirrors the database tables and internal data structures used by Dify
 * for component registration and tenant/account management.
 */

// ─────────────────────────────────────────────────────────────
// Tenant & Account
// ─────────────────────────────────────────────────────────────

export interface DifyTenant {
  /** Tenant UUID */
  id: string;
  /** Display name */
  name: string;
  /** Public key used for encryption (PEM or base64) */
  encrypt_public_key: string;
}

export interface DifyAccount {
  /** Account UUID */
  id: string;
  /** Display name */
  name: string;
  /** Email address */
  email: string;
}

// ─────────────────────────────────────────────────────────────
// Tool Providers (Database mirrors)
// ─────────────────────────────────────────────────────────────

/**
 * Mirrors the `tool_api_providers` table.
 * Represents an API-based tool provider registered in Dify.
 */
export interface DifyApiToolProvider {
  /** Primary key UUID */
  id: string;
  /** Tenant UUID */
  tenant_id: string;
  /** Provider name (unique within tenant) */
  name: string;
  /** Human-readable label */
  label?: string;
  /** Icon URL or emoji */
  icon?: string;
  /** OpenAPI schema (JSON string) or URL */
  schema?: string;
  /** Schema type: openapi or openapi_yaml */
  schema_type?: 'openapi' | 'openapi_yaml';
  /** Encrypted credentials JSON */
  credentials?: string;
  /** Provider description */
  description?: string;
  /** Privacy policy URL */
  privacy_policy?: string;
  /** Custom disclaimer text */
  custom_disclaimer?: string;
  /** Whether the provider is system-level */
  is_system?: boolean;
  /** Creation timestamp */
  created_at?: Date;
  /** Last update timestamp */
  updated_at?: Date;
}

/**
 * Mirrors the `tool_mcp_providers` table.
 * Represents an MCP-based tool provider registered in Dify.
 */
export interface DifyMCPToolProvider {
  /** Primary key UUID */
  id: string;
  /** Tenant UUID */
  tenant_id: string;
  /** Provider name (unique within tenant) */
  name: string;
  /** Human-readable label */
  label?: string;
  /** Icon URL or emoji */
  icon?: string;
  /** MCP server configuration JSON */
  config?: string;
  /** Provider description */
  description?: string;
  /** Whether the provider is system-level */
  is_system?: boolean;
  /** Creation timestamp */
  created_at?: Date;
  /** Last update timestamp */
  updated_at?: Date;
}
