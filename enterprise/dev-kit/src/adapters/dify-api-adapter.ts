import axios, { AxiosInstance } from 'axios';
import { IDifyAdapter, ToolRegistrationResult, ProviderStatus } from './dify-adapter.interface';
import { ToolDSL } from '../types/dsl';

export class DifyApiAdapter implements IDifyAdapter {
  private client: AxiosInstance;

  constructor(baseUrl: string, apiKey: string) {
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
    await this.client.get('/v1/info');
  }

  async disconnect(): Promise<void> {
    // HTTP client — no persistent connection to close
  }

  async registerTool(dsl: ToolDSL): Promise<ToolRegistrationResult> {
    const endpoint =
      dsl.spec.type === 'api'
        ? '/v1/workspaces/current/tool-providers/api'
        : '/v1/workspaces/current/tool-providers/mcp';

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
    const response = await this.client.get('/v1/workspaces/current/tool-providers', { params });
    return (response.data.data as Record<string, unknown>[]).map((p) => ({
      id: p.id as string,
      name: p.name as string,
      type: p.type as 'api' | 'mcp',
      updatedAt: new Date(p.updated_at as string),
    }));
  }

  async deleteProvider(providerId: string): Promise<void> {
    await this.client.delete(`/v1/workspaces/current/tool-providers/${providerId}`);
  }
}
