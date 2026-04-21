import { ToolDSL, WorkflowDSL, PluginDSL, McpExportConfig } from '../types/dsl';

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

export interface WorkflowRunResult {
  taskId: string;
  workflowRunId: string;
  status: 'running' | 'succeeded' | 'failed' | 'stopped';
  outputs?: Record<string, unknown>;
  error?: string;
}

export interface WorkflowRunOptions {
  /** Workflow input variables. */
  inputs: Record<string, unknown>;
  /** Dify user identifier for the run. */
  userId: string;
  /** Stream mode: true = SSE stream, false = blocking. */
  stream?: boolean;
}

export interface McpServerInfo {
  /** Dify-assigned MCP endpoint URL. */
  endpointUrl: string;
  /** Auth token (present when authMode === 'pre-authorized'). */
  token?: string;
}

export interface PluginInstallResult {
  success: boolean;
  pluginId: string;
  installedVersion: string;
  action: 'installed' | 'upgraded' | 'already_current';
  message: string;
}

/**
 * All Dify state mutations must go through this interface.
 * Direct PostgreSQL access is prohibited — use DifyApiAdapter (default) or
 * DifyDbAdapter (@deprecated) as the implementation.
 */
export interface IDifyAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // ── Tool Provider (Phase 1) ─────────────────────────────────
  registerTool(dsl: ToolDSL): Promise<ToolRegistrationResult>;
  listProviders(tenantId?: string): Promise<ProviderStatus[]>;
  deleteProvider(providerId: string): Promise<void>;

  // ── Workflow Execution (Dify v1.13+, Phase 2) ───────────────
  runWorkflow(appId: string, options: WorkflowRunOptions): Promise<WorkflowRunResult>;
  stopWorkflowTask(taskId: string, userId: string): Promise<void>;

  // ── MCP Outbound Export (Dify v1.6+) ───────────────────────
  configureMcpExport(appId: string, config: McpExportConfig): Promise<McpServerInfo>;
  getMcpServerInfo(appId: string): Promise<McpServerInfo | null>;

  // ── Plugin Management (Dify v1.6+ Marketplace, Phase 2) ────
  installPlugin(dsl: PluginDSL): Promise<PluginInstallResult>;
  listPlugins(): Promise<Array<{ id: string; name: string; version: string }>>;
  uninstallPlugin(pluginId: string): Promise<void>;
}
