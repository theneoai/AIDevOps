/**
 * Dify Client
 *
 * High-level client that orchestrates the full registration flow:
 * 1. Parse YAML DSL
 * 2. Compile to Dify internal format
 * 3. Register in Dify database
 */

import { loadConfig, DevKitConfig } from '../core/config';
import { parseToolDSLFromFile } from '../core/parser';
import { compileApiTool, compileMCPTool } from '../core/compiler';
import { DifyDbClient } from './db-client';
import { ToolDSL } from '../types/dsl';
import { sha256 } from './crypto';

// ─────────────────────────────────────────────────────────────
// Registration Result
// ─────────────────────────────────────────────────────────────

export interface RegistrationResult {
  success: boolean;
  providerId: string;
  providerType: 'api' | 'mcp';
  action: 'created' | 'updated';
  message: string;
}

// ─────────────────────────────────────────────────────────────
// Dify Client
// ─────────────────────────────────────────────────────────────

export class DifyClient {
  private db: DifyDbClient;
  private config: DevKitConfig;

  constructor(config?: DevKitConfig) {
    this.config = config || loadConfig();
    this.db = new DifyDbClient(this.config.dify.db);
  }

  async connect(): Promise<void> {
    await this.db.connect();
  }

  async disconnect(): Promise<void> {
    await this.db.disconnect();
  }

  // ─────────────────────────────────────────────────────────────
  // Tool Registration
  // ─────────────────────────────────────────────────────────────

  /**
   * Register a tool from a YAML file.
   */
  async registerToolFromFile(filePath: string): Promise<RegistrationResult> {
    const dsl = parseToolDSLFromFile(filePath);
    return this.registerTool(dsl);
  }

  /**
   * Register a tool from a parsed DSL object.
   */
  async registerTool(dsl: ToolDSL): Promise<RegistrationResult> {
    const tenant = await this.db.getDefaultTenant();
    const user = await this.db.getDefaultUser();

    if (dsl.spec.type === 'api') {
      return this.registerApiTool(dsl, tenant.id, user.id);
    } else {
      return this.registerMcpTool(dsl, tenant.id, user.id, tenant.encryptPublicKey);
    }
  }

  private async registerApiTool(
    dsl: ToolDSL,
    tenantId: string,
    userId: string
  ): Promise<RegistrationResult> {
    const provider = compileApiTool(dsl, tenantId, userId);

    // Build tools_str from the compiler's helper (we need to reconstruct it)
    const tools = (dsl.spec.endpoints || []).map((ep) => ({
      server_url:
        typeof dsl.spec.server === 'string'
          ? dsl.spec.server
          : dsl.spec.server?.url || '',
      method: ep.method.toLowerCase(),
      summary: ep.summary || ep.operationId,
      operation_id: ep.operationId,
      author: dsl.metadata.author || 'enterprise',
      parameters: (ep.inputs || []).map((input) => ({
        name: input.name,
        label: {
          en_US: input.name,
          zh_Hans: input.description || input.name,
        },
        type: input.type === 'integer' ? 'number' : input.type,
        form: 'llm',
        llm_description: input.description || '',
        required: input.required ?? false,
        ...(input.default !== undefined ? { default: input.default } : {}),
      })),
      openapi: {
        operationId: ep.operationId,
        summary: ep.summary || ep.operationId,
        requestBody: {
          content: {
            'application/json': {
              schema: buildRequestSchema(ep.inputs || []),
            },
          },
        },
      },
    }));

    const toolsStr = JSON.stringify(tools);
    const providerId = await this.db.registerApiToolProvider(provider, toolsStr, userId);

    return {
      success: true,
      providerId,
      providerType: 'api',
      action: 'created', // TODO: detect update vs create
      message: `API tool provider '${dsl.metadata.name}' registered successfully`,
    };
  }

  private async registerMcpTool(
    dsl: ToolDSL,
    tenantId: string,
    userId: string,
    encryptPublicKey?: string | null
  ): Promise<RegistrationResult> {
    const provider = compileMCPTool(dsl, tenantId, userId);
    const serverUrl =
      typeof dsl.spec.server === 'string'
        ? dsl.spec.server
        : dsl.spec.server?.url || '';

    const tools = (dsl.spec.tools || []).map((tool) => ({
      name: tool.name,
      description: tool.description || '',
      inputSchema: {
        type: 'object',
        properties: buildSchemaProperties(tool.inputs || []),
        required: (tool.inputs || [])
          .filter((i) => i.required)
          .map((i) => i.name),
      },
    }));

    const providerId = await this.db.registerMcpToolProvider(
      provider,
      serverUrl,
      tools,
      encryptPublicKey
    );

    return {
      success: true,
      providerId,
      providerType: 'mcp',
      action: 'created',
      message: `MCP tool provider '${dsl.metadata.name}' registered successfully`,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Status
  // ─────────────────────────────────────────────────────────────

  async getStatus(tenantId?: string): Promise<{
    apiProviders: Array<{ id: string; name: string; updated_at: Date }>;
    mcpProviders: Array<{ id: string; name: string; updated_at: Date }>;
  }> {
    const tenant = tenantId
      ? { id: tenantId }
      : await this.db.getDefaultTenant();

    const [apiProviders, mcpProviders] = await Promise.all([
      this.db.listApiProviders(tenant.id),
      this.db.listMcpProviders(tenant.id),
    ]);

    return { apiProviders, mcpProviders };
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function buildRequestSchema(inputs: Array<{ name: string; type: string; description?: string; required?: boolean; default?: unknown; enum?: unknown[] }>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const input of inputs) {
    const prop: Record<string, unknown> = {
      type: input.type === 'integer' ? 'integer' : input.type,
    };
    if (input.description) prop.description = input.description;
    if (input.enum) prop.enum = input.enum;
    if (input.default !== undefined) prop.default = input.default;
    properties[input.name] = prop;

    if (input.required) {
      required.push(input.name);
    }
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function buildSchemaProperties(inputs: Array<{ name: string; type: string; description?: string; required?: boolean; default?: unknown; enum?: unknown[] }>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};

  for (const input of inputs) {
    const prop: Record<string, unknown> = {
      type: input.type === 'integer' ? 'string' : input.type,
      description: input.description || '',
    };
    if (input.enum) prop.enum = input.enum;
    properties[input.name] = prop;
  }

  return properties;
}
