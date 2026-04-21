import axios, { AxiosInstance, AxiosError } from 'axios';
import { Langfuse } from 'langfuse';
import {
  IDifyAdapter,
  ToolRegistrationResult,
  ProviderStatus,
  WorkflowRunResult,
  WorkflowRunOptions,
  McpServerInfo,
  PluginInstallResult,
  DifyApiNotAvailableError,
  DifyVersionMismatchError,
} from './dify-adapter.interface';
import { ToolDSL, PluginDSL, McpExportConfig } from '../types/dsl';

// ─────────────────────────────────────────────────────────────
// API Path Configuration
//
// All Dify REST paths are collected here so version upgrades only
// require updating this one object (or passing a custom object to
// the constructor) — no hunting through method bodies.
//
// STABILITY TIERS (important for future Dify upgrades):
//   STABLE   — confirmed in Dify public documentation, safe to rely on
//   EXPERIMENTAL — inferred from Dify source / blogs, may change
// ─────────────────────────────────────────────────────────────

export interface DifyApiPaths {
  // STABLE: present since Dify v0.x
  info: string;
  // STABLE: tool provider CRUD
  toolProviders: string;
  toolProviderApi: string;
  toolProviderMcp: string;
  toolProvider: (id: string) => string;
  // STABLE: workflow execution (Dify v1.x service API)
  workflowRun: string;
  workflowTaskStop: (taskId: string) => string;
  // EXPERIMENTAL: MCP outbound — Dify v1.6 uses a plugin, not a native endpoint
  appMcpPublish: (appId: string) => string;
  appMcpInfo: (appId: string) => string;
  // EXPERIMENTAL: plugin management API not yet publicly documented
  plugins: string;
  pluginInstall: string;
  plugin: (pluginId: string) => string;
}

export const DIFY_V1_PATHS: DifyApiPaths = {
  // STABLE paths (confirmed in Dify public docs)
  info: '/v1/info',
  toolProviders: '/v1/workspaces/current/tool-providers',
  toolProviderApi: '/v1/workspaces/current/tool-providers/api',
  toolProviderMcp: '/v1/workspaces/current/tool-providers/mcp',
  toolProvider: (id) => `/v1/workspaces/current/tool-providers/${id}`,
  workflowRun: '/v1/workflows/run',
  workflowTaskStop: (taskId) => `/v1/workflows/tasks/${taskId}/stop`,
  // EXPERIMENTAL paths (speculative — update when Dify publishes official docs)
  appMcpPublish: (appId) => `/v1/apps/${appId}/mcp/publish`,
  appMcpInfo: (appId) => `/v1/apps/${appId}/mcp`,
  plugins: '/v1/workspaces/current/plugins',
  pluginInstall: '/v1/workspaces/current/plugins/install',
  plugin: (pluginId) => `/v1/workspaces/current/plugins/${encodeURIComponent(pluginId)}`,
};

// ─────────────────────────────────────────────────────────────
// Version Config (passed from BackendConfig)
// ─────────────────────────────────────────────────────────────

export interface DifyVersionBounds {
  minVersion?: string;
  maxVersion?: string;
}

// ─────────────────────────────────────────────────────────────
// Langfuse Tracing Helper (no-op when env vars absent)
// ─────────────────────────────────────────────────────────────

function createLangfuse(): Langfuse | null {
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    return null;
  }
  return new Langfuse({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com',
    flushAt: 1,
  });
}

// ─────────────────────────────────────────────────────────────
// Semver helpers (no external dependency)
// ─────────────────────────────────────────────────────────────

/** Compare two "x.y.z" version strings. Returns negative/0/positive like strcmp. */
function compareSemver(a: string, b: string): number {
  const pa = a.replace(/[^0-9.]/g, '').split('.').map(Number);
  const pb = b.replace(/[^0-9.]/g, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Expand a maxVersion wildcard like "1.14.x" → "1.14.99999". */
function expandWildcard(v: string): string {
  return v.replace(/x/gi, '99999');
}

// ─────────────────────────────────────────────────────────────
// HTTP 404 → DifyApiNotAvailableError helper
// ─────────────────────────────────────────────────────────────

function guardExperimental<T>(
  path: string,
  requiredVersion: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return fn().catch((err: unknown) => {
    if (err instanceof AxiosError && err.response?.status === 404) {
      throw new DifyApiNotAvailableError(path, requiredVersion);
    }
    throw err;
  });
}

// ─────────────────────────────────────────────────────────────
// DifyApiAdapter
// ─────────────────────────────────────────────────────────────

export class DifyApiAdapter implements IDifyAdapter {
  private client: AxiosInstance;
  private paths: DifyApiPaths;
  private langfuse: Langfuse | null;
  private versionBounds: DifyVersionBounds;

  constructor(
    baseUrl: string,
    apiKey: string,
    paths: DifyApiPaths = DIFY_V1_PATHS,
    versionBounds: DifyVersionBounds = {},
  ) {
    this.paths = paths;
    this.versionBounds = versionBounds;
    this.langfuse = createLangfuse();
    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
    });
  }

  /**
   * Validates connectivity and enforces minVersion/maxVersion bounds from dify-dev.yaml.
   * Call this once at startup before any other operations.
   */
  async connect(): Promise<void> {
    const response = await this.client.get(this.paths.info);
    const connectedVersion: string = response.data?.version ?? '0.0.0';
    const { minVersion, maxVersion } = this.versionBounds;

    if (minVersion && compareSemver(connectedVersion, minVersion) < 0) {
      throw new DifyVersionMismatchError(connectedVersion, minVersion, maxVersion);
    }
    if (maxVersion && compareSemver(connectedVersion, expandWildcard(maxVersion)) > 0) {
      throw new DifyVersionMismatchError(connectedVersion, minVersion, maxVersion);
    }
  }

  async disconnect(): Promise<void> {
    if (this.langfuse) {
      await this.langfuse.shutdownAsync();
    }
  }

  // ── Tool Provider (STABLE) ───────────────────────────────────

  async registerTool(dsl: ToolDSL): Promise<ToolRegistrationResult> {
    const trace = this.langfuse?.trace({
      name: 'dify.tool.register',
      input: { name: dsl.metadata.name, type: dsl.spec.type },
      tags: ['devkit', 'tool-registration'],
    });
    const span = trace?.span({ name: 'api.post.tool-provider' });

    try {
      const endpoint =
        dsl.spec.type === 'api' ? this.paths.toolProviderApi : this.paths.toolProviderMcp;
      const response = await this.client.post(endpoint, dsl);
      const result: ToolRegistrationResult = {
        success: true,
        providerId: response.data.id,
        providerType: dsl.spec.type as 'api' | 'mcp',
        action: response.status === 201 ? 'created' : 'updated',
        message: `Tool '${dsl.metadata.name}' registered via Dify API`,
      };
      span?.end({ output: result });
      trace?.update({ output: result });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      span?.end({ level: 'ERROR', statusMessage: msg });
      trace?.update({ output: { error: msg } });
      throw err;
    }
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

  // ── Workflow Execution (STABLE, Dify v1.x Service API) ───────
  //
  // Auth note: Dify's Service API uses PER-APP API keys, not the workspace
  // admin key used for tool provider registration. Pass `options.appApiKey`
  // when this adapter is initialised with a workspace key; otherwise the
  // adapter's configured key is used as-is (works when the adapter is
  // initialised per-app).

  async runWorkflow(options: WorkflowRunOptions): Promise<WorkflowRunResult> {
    const trace = this.langfuse?.trace({
      name: 'dify.workflow.run',
      input: { inputs: options.inputs },
      userId: options.userId,
      tags: ['devkit', 'workflow-run'],
    });
    const span = trace?.span({ name: 'api.post.workflow-run' });

    try {
      // If the caller provided a per-app key, override the Authorization header
      // for this request only. Do NOT mutate the shared axios instance.
      const requestConfig = options.appApiKey
        ? { headers: { Authorization: `Bearer ${options.appApiKey}` } }
        : undefined;

      const response = await this.client.post(
        this.paths.workflowRun,
        {
          inputs: options.inputs,
          response_mode: options.stream ? 'streaming' : 'blocking',
          user: options.userId,
        },
        requestConfig,
      );

      const result: WorkflowRunResult = {
        taskId: response.data.task_id ?? '',
        workflowRunId: response.data.workflow_run_id ?? '',
        status: response.data.data?.status ?? 'running',
        outputs: response.data.data?.outputs,
      };
      span?.end({ output: result });
      trace?.update({ output: result });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      span?.end({ level: 'ERROR', statusMessage: msg });
      trace?.update({ output: { error: msg } });
      throw err;
    }
  }

  async stopWorkflowTask(taskId: string, userId: string): Promise<void> {
    await this.client.post(this.paths.workflowTaskStop(taskId), { user: userId });
  }

  // ── MCP Outbound Export (@experimental) ─────────────────────
  //
  // In Dify v1.6 the MCP export is provided by the hjlarry/mcp-server
  // Marketplace plugin and operates through Dify's plugin endpoint mechanism,
  // NOT through a native console REST endpoint. The paths below are speculative.
  // Both methods will throw DifyApiNotAvailableError (404 guard) until Dify
  // publishes an official REST API for this feature.

  async configureMcpExport(appId: string, config: McpExportConfig): Promise<McpServerInfo> {
    const trace = this.langfuse?.trace({
      name: 'dify.mcp.export.configure',
      input: { appId, authMode: config.authMode },
      tags: ['devkit', 'mcp-export'],
    });

    try {
      return await guardExperimental(
        this.paths.appMcpPublish(appId),
        '1.6.0',
        async () => {
          const response = await this.client.post(this.paths.appMcpPublish(appId), {
            enabled: config.enabled,
            auth_mode: config.authMode ?? 'pre-authorized',
            description: config.description,
            path_suffix: config.pathSuffix,
          });
          const info: McpServerInfo = {
            endpointUrl: response.data.endpoint_url,
            token: response.data.token,
          };
          trace?.update({ output: info });
          return info;
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      trace?.update({ output: { error: msg } });
      throw err;
    }
  }

  async getMcpServerInfo(appId: string): Promise<McpServerInfo | null> {
    return guardExperimental(
      this.paths.appMcpInfo(appId),
      '1.6.0',
      async () => {
        const response = await this.client.get(this.paths.appMcpInfo(appId));
        if (!response.data?.endpoint_url) return null;
        return {
          endpointUrl: response.data.endpoint_url,
          token: response.data.token,
        };
      },
    ).catch((err) => {
      // For GET, treat not-available as null (no MCP configured) rather than hard fail
      if (err instanceof DifyApiNotAvailableError) return null;
      throw err;
    });
  }

  // ── Plugin Management (@experimental) ───────────────────────
  //
  // Dify's plugin management REST API is not yet publicly documented.
  // All methods throw DifyApiNotAvailableError on 404 until confirmed.

  async installPlugin(dsl: PluginDSL): Promise<PluginInstallResult> {
    const trace = this.langfuse?.trace({
      name: 'dify.plugin.install',
      input: { name: dsl.metadata.name, source: dsl.spec.source, pluginId: dsl.spec.pluginId },
      tags: ['devkit', 'plugin-install'],
    });

    try {
      return await guardExperimental(
        this.paths.pluginInstall,
        '1.6.0',
        async () => {
          const payload: Record<string, unknown> = { source: dsl.spec.source, config: dsl.spec.config ?? {} };
          if (dsl.spec.source === 'marketplace') {
            payload.plugin_id = dsl.spec.pluginId;
            payload.version = dsl.spec.version;
          } else if (dsl.spec.source === 'git') {
            payload.git_url = dsl.spec.gitUrl;
            payload.git_ref = dsl.spec.gitRef;
          } else {
            payload.local_path = dsl.spec.localPath;
          }
          const response = await this.client.post(this.paths.pluginInstall, payload);
          const result: PluginInstallResult = {
            success: true,
            pluginId: response.data.plugin_id ?? dsl.spec.pluginId ?? dsl.metadata.name,
            installedVersion: response.data.version ?? dsl.spec.version ?? 'unknown',
            action: response.status === 201 ? 'installed' : 'upgraded',
            message: `Plugin '${dsl.metadata.name}' installed from ${dsl.spec.source}`,
          };
          trace?.update({ output: result });
          return result;
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      trace?.update({ output: { error: msg } });
      throw err;
    }
  }

  async listPlugins(): Promise<Array<{ id: string; name: string; version: string }>> {
    return guardExperimental(this.paths.plugins, '1.6.0', async () => {
      const response = await this.client.get(this.paths.plugins);
      return (response.data.data as Record<string, unknown>[]).map((p) => ({
        id: p.plugin_id as string,
        name: p.name as string,
        version: p.version as string,
      }));
    });
  }

  async uninstallPlugin(pluginId: string): Promise<void> {
    return guardExperimental(this.paths.plugin(pluginId), '1.6.0', async () => {
      await this.client.delete(this.paths.plugin(pluginId));
    });
  }
}
