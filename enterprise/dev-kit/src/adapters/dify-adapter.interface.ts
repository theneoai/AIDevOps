import { ToolDSL, PluginDSL, McpExportConfig } from '../types/dsl';

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
  /** Dify user identifier for the run (passed as `user` in the request body). */
  userId: string;
  /** Stream mode: true = SSE stream, false = blocking. */
  stream?: boolean;
  /**
   * App-scoped API key for this specific Dify workflow application.
   * Dify Service API uses per-app API keys (generated per application in the UI),
   * which are DIFFERENT from the console/workspace admin key used for tool provider
   * registration. Provide this when the adapter was initialised with a workspace key.
   *
   * @see https://docs.dify.ai/en/use-dify/publish/developing-with-apis
   */
  appApiKey?: string;
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

  // ── Tool Provider (Phase 1) — confirmed Dify public API ────────
  registerTool(dsl: ToolDSL): Promise<ToolRegistrationResult>;
  listProviders(tenantId?: string): Promise<ProviderStatus[]>;
  deleteProvider(providerId: string): Promise<void>;

  // ── Workflow Execution (Dify v1.13+, Phase 2) ──────────────────
  // Endpoint: POST /v1/workflows/run (confirmed in Dify docs)
  runWorkflow(options: WorkflowRunOptions): Promise<WorkflowRunResult>;
  stopWorkflowTask(taskId: string, userId: string): Promise<void>;

  // ── MCP Outbound Export (@experimental — Dify v1.6+) ───────────
  // NOTE: In Dify v1.6, MCP export is provided by the hjlarry/mcp-server
  // Marketplace plugin, NOT by a native REST API endpoint.
  // These methods target speculative future REST endpoints. They will throw
  // DifyApiNotAvailableError if Dify returns 404 until the API is published.
  configureMcpExport(appId: string, config: McpExportConfig): Promise<McpServerInfo>;
  getMcpServerInfo(appId: string): Promise<McpServerInfo | null>;

  // ── Plugin Management (@experimental — Dify v1.6+ Marketplace) ─
  // NOTE: Dify's plugin management REST API is not yet publicly documented.
  // These methods will throw DifyApiNotAvailableError until the API is published.
  installPlugin(dsl: PluginDSL): Promise<PluginInstallResult>;
  listPlugins(): Promise<Array<{ id: string; name: string; version: string }>>;
  uninstallPlugin(pluginId: string): Promise<void>;
}

// ─────────────────────────────────────────────────────────────
// Error Types
// ─────────────────────────────────────────────────────────────

/**
 * Thrown when a Dify REST endpoint is not yet available in the connected
 * Dify version. Callers should catch this to handle graceful degradation.
 */
export class DifyApiNotAvailableError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly requiredVersion?: string,
  ) {
    const versionHint = requiredVersion ? ` (requires Dify >= ${requiredVersion})` : '';
    super(
      `Dify endpoint '${endpoint}' is not available on this instance${versionHint}. ` +
      `This feature may not yet be part of Dify's public REST API.`,
    );
    this.name = 'DifyApiNotAvailableError';
  }
}

/**
 * Thrown when the connected Dify version falls outside the configured
 * minVersion / maxVersion bounds in dify-dev.yaml.
 */
export class DifyVersionMismatchError extends Error {
  constructor(
    public readonly connectedVersion: string,
    public readonly minVersion?: string,
    public readonly maxVersion?: string,
  ) {
    super(
      `Dify version mismatch: connected=${connectedVersion}, ` +
      `required=${minVersion ?? '*'}..${maxVersion ?? '*'}. ` +
      `Update DIFY_VERSION and run check-dify-compat.sh before proceeding.`,
    );
    this.name = 'DifyVersionMismatchError';
  }
}
