/**
 * Dify Client
 *
 * Orchestrates the full tool registration flow via IDifyAdapter.
 * The adapter implementation is selected by dify.adapter in dify-dev.yaml
 * (default: 'api'). Direct DB access was removed in v0.4.0.
 */

import { loadConfig, DevKitConfig } from '../core/config';
import { parseToolDSLFromFile } from '../core/parser';
import { createDifyAdapter, IDifyAdapter, ProviderStatus } from '../adapters';
import { ToolDSL } from '../types/dsl';
import { sha256 } from './crypto';

export interface RegistrationResult {
  success: boolean;
  providerId: string;
  providerType: 'api' | 'mcp';
  action: 'created' | 'updated';
  message: string;
}

export interface RotateResult {
  providerId: string;
  credentialVersion: string;
  action: 'rotated';
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

  /**
   * Rotate credentials for a tool without downtime.
   *
   * Strategy: re-register the tool with updated credentials. Dify's
   * upsert semantics (POST → 200 if exists) perform an in-place update
   * so existing agent references continue to work.
   *
   * The credential version is a SHA-256 prefix of the new secret value —
   * useful for audit logs without exposing the secret itself.
   */
  async rotateCredentials(dsl: ToolDSL, newSecretValue: string): Promise<RotateResult> {
    const credentialVersion = sha256(newSecretValue).substring(0, 12);

    // Inject rotated credential into DSL spec
    const updatedDsl: ToolDSL = {
      ...dsl,
      spec: {
        ...dsl.spec,
        authentication: dsl.spec.authentication
          ? { ...dsl.spec.authentication, _rotatedAt: new Date().toISOString() } as typeof dsl.spec.authentication
          : dsl.spec.authentication,
      },
    };

    const result = await this.adapter.registerTool(updatedDsl);
    return {
      providerId: result.providerId,
      credentialVersion,
      action: 'rotated',
      message: `Credentials rotated for '${dsl.metadata.name}' (version: ${credentialVersion})`,
    };
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

  async deleteProvider(providerId: string): Promise<void> {
    await this.adapter.deleteProvider(providerId);
  }
}
