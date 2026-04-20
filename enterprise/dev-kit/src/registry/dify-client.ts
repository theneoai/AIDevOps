/**
 * Dify Client
 *
 * Orchestrates the full tool registration flow via IDifyAdapter.
 * The adapter implementation is selected by dify.adapter in dify-dev.yaml
 * (default: 'api'). Direct DB access has been moved to DifyDbAdapter (@deprecated).
 */

import { loadConfig, DevKitConfig } from '../core/config';
import { parseToolDSLFromFile } from '../core/parser';
import { createDifyAdapter, IDifyAdapter, ProviderStatus } from '../adapters';
import { ToolDSL } from '../types/dsl';

export interface RegistrationResult {
  success: boolean;
  providerId: string;
  providerType: 'api' | 'mcp';
  action: 'created' | 'updated';
  message: string;
}

export class DifyClient {
  private adapter: IDifyAdapter;

  constructor(config?: DevKitConfig) {
    const resolvedConfig = config || loadConfig();
    this.adapter = createDifyAdapter(resolvedConfig);
  }

  async connect(): Promise<void> {
    await this.adapter.connect();
  }

  async disconnect(): Promise<void> {
    await this.adapter.disconnect();
  }

  async registerToolFromFile(filePath: string): Promise<RegistrationResult> {
    const dsl = parseToolDSLFromFile(filePath);
    return this.registerTool(dsl);
  }

  async registerTool(dsl: ToolDSL): Promise<RegistrationResult> {
    return this.adapter.registerTool(dsl);
  }

  async getStatus(tenantId?: string): Promise<{
    apiProviders: ProviderStatus[];
    mcpProviders: ProviderStatus[];
  }> {
    const providers = await this.adapter.listProviders(tenantId);
    return {
      apiProviders: providers.filter((p) => p.type === 'api'),
      mcpProviders: providers.filter((p) => p.type === 'mcp'),
    };
  }
}
