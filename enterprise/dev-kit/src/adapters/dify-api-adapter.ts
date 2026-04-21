import axios, { AxiosInstance } from 'axios';
import { Langfuse } from 'langfuse';
import {
  IDifyAdapter,
  ToolRegistrationResult,
  ProviderStatus,
  WorkflowRunResult,
  WorkflowRunOptions,
  McpServerInfo,
  PluginInstallResult,
} from './dify-adapter.interface';
import { ToolDSL, WorkflowDSL, PluginDSL, McpExportConfig } from '../types/dsl';

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
  // Dify v1.13+: Workflow execution
  workflowRun: string;
  workflowTaskStop: (taskId: string) => string;
  // Dify v1.6+: MCP outbound export
  appMcpPublish: (appId: string) => string;
  appMcpInfo: (appId: string) => string;
  // Dify v1.6+: Plugin marketplace
  plugins: string;
  pluginInstall: string;
  plugin: (pluginId: string) => string;
}

export const DIFY_V1_PATHS: DifyApiPaths = {
  info: '/v1/info',
  toolProviders: '/v1/workspaces/current/tool-providers',
  toolProviderApi: '/v1/workspaces/current/tool-providers/api',
  toolProviderMcp: '/v1/workspaces/current/tool-providers/mcp',
  toolProvider: (id) => `/v1/workspaces/current/tool-providers/${id}`,
  // Workflow execution (Dify v1.13+)
  workflowRun: '/v1/workflows/run',
  workflowTaskStop: (taskId) => `/v1/workflows/tasks/${taskId}/stop`,
  // MCP outbound export (Dify v1.6+)
  appMcpPublish: (appId) => `/v1/apps/${appId}/mcp/publish`,
  appMcpInfo: (appId) => `/v1/apps/${appId}/mcp`,
  // Plugin management (Dify v1.6+)
  plugins: '/v1/workspaces/current/plugins',
  pluginInstall: '/v1/workspaces/current/plugins/install',
  plugin: (pluginId) => `/v1/workspaces/current/plugins/${encodeURIComponent(pluginId)}`,
};

// ─────────────────────────────────────────────────────────────
// Langfuse Tracing Helper
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
// DifyApiAdapter
// ─────────────────────────────────────────────────────────────

export class DifyApiAdapter implements IDifyAdapter {
  private client: AxiosInstance;
  private paths: DifyApiPaths;
  private langfuse: Langfuse | null;

  constructor(baseUrl: string, apiKey: string, paths: DifyApiPaths = DIFY_V1_PATHS) {
    this.paths = paths;
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

  async connect(): Promise<void> {
    await this.client.get(this.paths.info);
  }

  async disconnect(): Promise<void> {
    if (this.langfuse) {
      await this.langfuse.shutdownAsync();
    }
  }

  // ── Tool Provider ────────────────────────────────────────────

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

  // ── Workflow Execution (Dify v1.13+) ─────────────────────────

  async runWorkflow(appId: string, options: WorkflowRunOptions): Promise<WorkflowRunResult> {
    const trace = this.langfuse?.trace({
      name: 'dify.workflow.run',
      input: { appId, inputs: options.inputs },
      userId: options.userId,
      tags: ['devkit', 'workflow-run'],
    });
    const span = trace?.span({ name: 'api.post.workflow-run' });

    try {
      const response = await this.client.post(this.paths.workflowRun, {
        inputs: options.inputs,
        response_mode: options.stream ? 'streaming' : 'blocking',
        user: options.userId,
      }, {
        headers: { Authorization: `Bearer ${appId}` },
      });

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

  // ── MCP Outbound Export (Dify v1.6+) ─────────────────────────

  async configureMcpExport(appId: string, config: McpExportConfig): Promise<McpServerInfo> {
    const trace = this.langfuse?.trace({
      name: 'dify.mcp.export.configure',
      input: { appId, authMode: config.authMode },
      tags: ['devkit', 'mcp-export'],
    });

    try {
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      trace?.update({ output: { error: msg } });
      throw err;
    }
  }

  async getMcpServerInfo(appId: string): Promise<McpServerInfo | null> {
    try {
      const response = await this.client.get(this.paths.appMcpInfo(appId));
      if (!response.data?.endpoint_url) return null;
      return {
        endpointUrl: response.data.endpoint_url,
        token: response.data.token,
      };
    } catch {
      return null;
    }
  }

  // ── Plugin Management (Dify v1.6+ Marketplace) ───────────────

  async installPlugin(dsl: PluginDSL): Promise<PluginInstallResult> {
    const trace = this.langfuse?.trace({
      name: 'dify.plugin.install',
      input: { name: dsl.metadata.name, source: dsl.spec.source, pluginId: dsl.spec.pluginId },
      tags: ['devkit', 'plugin-install'],
    });

    try {
      const payload: Record<string, unknown> = {
        source: dsl.spec.source,
        config: dsl.spec.config ?? {},
      };

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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      trace?.update({ output: { error: msg } });
      throw err;
    }
  }

  async listPlugins(): Promise<Array<{ id: string; name: string; version: string }>> {
    const response = await this.client.get(this.paths.plugins);
    return (response.data.data as Record<string, unknown>[]).map((p) => ({
      id: p.plugin_id as string,
      name: p.name as string,
      version: p.version as string,
    }));
  }

  async uninstallPlugin(pluginId: string): Promise<void> {
    await this.client.delete(this.paths.plugin(pluginId));
  }
}
