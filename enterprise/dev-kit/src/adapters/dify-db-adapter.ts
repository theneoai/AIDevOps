import { IDifyAdapter, ToolRegistrationResult, ProviderStatus } from './dify-adapter.interface';
import { DifyDbClient } from '../registry/db-client';
import { DifyDatabaseConfig } from '../core/config';
import { ToolDSL } from '../types/dsl';
import { compileApiTool, compileMCPTool } from '../core/compiler';

/**
 * @deprecated Direct PostgreSQL access bypasses Dify API validation and breaks on schema changes.
 * Migrate to DifyApiAdapter. This adapter will be removed in v0.4.0.
 */
export class DifyDbAdapter implements IDifyAdapter {
  private db: DifyDbClient;

  constructor(dbConfig: DifyDatabaseConfig) {
    this.db = new DifyDbClient(dbConfig);
  }

  async connect(): Promise<void> {
    await this.db.connect();
  }

  async disconnect(): Promise<void> {
    await this.db.disconnect();
  }

  async registerTool(dsl: ToolDSL): Promise<ToolRegistrationResult> {
    const tenant = await this.db.getDefaultTenant();
    const user = await this.db.getDefaultUser();

    if (dsl.spec.type === 'api') {
      const provider = compileApiTool(dsl, tenant.id, user.id);
      const tools = buildApiToolsStr(dsl);
      const providerId = await this.db.registerApiToolProvider(provider, JSON.stringify(tools), user.id);
      return {
        success: true,
        providerId,
        providerType: 'api',
        action: 'created',
        message: `[DB] API tool '${dsl.metadata.name}' registered`,
      };
    }

    const provider = compileMCPTool(dsl, tenant.id, user.id);
    const serverUrl =
      typeof dsl.spec.server === 'string' ? dsl.spec.server : dsl.spec.server?.url || '';
    const tools = (dsl.spec.tools || []).map((t) => ({
      name: t.name,
      description: t.description || '',
      inputSchema: {
        type: 'object',
        properties: buildSchemaProperties(t.inputs || []),
        required: (t.inputs || []).filter((i) => i.required).map((i) => i.name),
      },
    }));
    const providerId = await this.db.registerMcpToolProvider(
      provider,
      serverUrl,
      tools,
      tenant.encryptPublicKey
    );
    return {
      success: true,
      providerId,
      providerType: 'mcp',
      action: 'created',
      message: `[DB] MCP tool '${dsl.metadata.name}' registered`,
    };
  }

  async listProviders(tenantId?: string): Promise<ProviderStatus[]> {
    const tenant = tenantId ? { id: tenantId } : await this.db.getDefaultTenant();
    const [apiRows, mcpRows] = await Promise.all([
      this.db.listApiProviders(tenant.id),
      this.db.listMcpProviders(tenant.id),
    ]);
    return [
      ...apiRows.map((r) => ({ id: r.id, name: r.name, type: 'api' as const, updatedAt: r.updated_at })),
      ...mcpRows.map((r) => ({ id: r.id, name: r.name, type: 'mcp' as const, updatedAt: r.updated_at })),
    ];
  }

  async deleteProvider(_providerId: string): Promise<void> {
    throw new Error('deleteProvider not supported by DifyDbAdapter. Use DifyApiAdapter.');
  }
}

type InputField = {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
};

function buildApiToolsStr(dsl: ToolDSL): unknown[] {
  return (dsl.spec.endpoints || []).map((ep) => ({
    server_url:
      typeof dsl.spec.server === 'string' ? dsl.spec.server : dsl.spec.server?.url || '',
    method: ep.method.toLowerCase(),
    summary: ep.summary || ep.operationId,
    operation_id: ep.operationId,
    author: dsl.metadata.author || 'enterprise',
    parameters: (ep.inputs || []).map((input: InputField) => ({
      name: input.name,
      label: { en_US: input.name, zh_Hans: input.description || input.name },
      type: input.type === 'integer' ? 'number' : input.type,
      form: 'llm',
      llm_description: input.description || '',
      required: input.required ?? false,
      ...(input.default !== undefined ? { default: input.default } : {}),
    })),
  }));
}

function buildSchemaProperties(inputs: InputField[]): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const input of inputs) {
    props[input.name] = {
      type: input.type === 'integer' ? 'string' : input.type,
      description: input.description || '',
      ...(input.enum ? { enum: input.enum } : {}),
    };
  }
  return props;
}
