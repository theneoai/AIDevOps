import axios, { AxiosInstance } from 'axios';
import { IDifyAdapter, ToolRegistrationResult, ProviderStatus } from './dify-adapter.interface';
import { ToolDSL } from '../types/dsl';

// ─────────────────────────────────────────────────────────────
// API Path Configuration
// Centralised here so callers can override for non-standard Dify
// deployments or future API version bumps without patching internals.
// ─────────────────────────────────────────────────────────────

export interface DifyApiPaths {
  info: string;
  toolProviders: string;
  toolProviderApi: string;
  toolProviderMcp: string;
  toolProvider: (id: string) => string;
}

export const DIFY_V1_PATHS: DifyApiPaths = {
  info: '/v1/info',
  toolProviders: '/v1/workspaces/current/tool-providers',
  toolProviderApi: '/v1/workspaces/current/tool-providers/api',
  toolProviderMcp: '/v1/workspaces/current/tool-providers/mcp',
  toolProvider: (id) => `/v1/workspaces/current/tool-providers/${id}`,
};

export class DifyApiAdapter implements IDifyAdapter {
  private client: AxiosInstance;
  private paths: DifyApiPaths;

  constructor(baseUrl: string, apiKey: string, paths: DifyApiPaths = DIFY_V1_PATHS) {
    this.paths = paths;
    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
    });
  }

  async connect(): Promise<void> {
    await this.client.get(this.paths.info);
  }

  async disconnect(): Promise<void> {
    // HTTP client — no persistent connection to close
  }

  async registerTool(dsl: ToolDSL): Promise<ToolRegistrationResult> {
    const endpoint =
      dsl.spec.type === 'api' ? this.paths.toolProviderApi : this.paths.toolProviderMcp;

    const response = await this.client.post(endpoint, dsl);
    return {
      success: true,
      providerId: response.data.id,
      providerType: dsl.spec.type as 'api' | 'mcp',
      action: response.status === 201 ? 'created' : 'updated',
      message: `Tool '${dsl.metadata.name}' registered via Dify API`,
    };
  }

  async listProviders(tenantId?: string): Promise<ProviderStatus[]> {
    const params = tenantId ? { tenant_id: tenantId } : {};
    const response = await this.client.get(this.paths.toolProviders, { params });
    return (response.data.data as Record<string, unknown>[]).map((p) => ({
      id: p.id as string,
      name: p.name as string,
      type: p.type as 'api' | 'mcp',
      updatedAt: new Date(p.updated_at as string),
    }));
  }

  async deleteProvider(providerId: string): Promise<void> {
    await this.client.delete(this.paths.toolProvider(providerId));
  }
}

