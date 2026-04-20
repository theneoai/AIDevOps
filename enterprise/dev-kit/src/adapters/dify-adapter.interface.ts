import { ToolDSL } from '../types/dsl';

export interface ToolRegistrationResult {
  success: boolean;
  providerId: string;
  providerType: 'api' | 'mcp';
  action: 'created' | 'updated';
  message: string;
}

export interface ProviderStatus {
  id: string;
  name: string;
  type: 'api' | 'mcp';
  updatedAt: Date;
}

/**
 * All Dify state mutations must go through this interface.
 * Direct PostgreSQL access is prohibited — use DifyApiAdapter (default) or
 * DifyDbAdapter (@deprecated) as the implementation.
 */
export interface IDifyAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  registerTool(dsl: ToolDSL): Promise<ToolRegistrationResult>;
  listProviders(tenantId?: string): Promise<ProviderStatus[]>;
  deleteProvider(providerId: string): Promise<void>;
}
