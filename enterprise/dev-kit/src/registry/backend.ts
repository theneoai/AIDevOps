/**
 * P5-1: Multi-Backend Support
 *
 * ComponentBackend interface decouples DevKit from any single orchestration
 * platform. Implement this interface to support Dify, Langflow, LangChain, etc.
 */

import axios, { AxiosInstance } from 'axios';
import { ToolDSL, WorkflowSpec } from '../types/dsl';

// ─────────────────────────────────────────────────────────────
// Shared Types
// ─────────────────────────────────────────────────────────────

export type ComponentStatus = {
  id: string;
  name: string;
  version: string;
  state: 'active' | 'inactive' | 'error';
  updatedAt: Date;
  backendUrl?: string;
};

export type BackendType = 'dify' | 'langflow' | 'langchain';

// ─────────────────────────────────────────────────────────────
// ComponentBackend Interface
// ─────────────────────────────────────────────────────────────

export interface ComponentBackend {
  readonly backendType: BackendType;

  registerTool(spec: ToolDSL): Promise<string>;
  updateTool(id: string, spec: ToolDSL): Promise<void>;
  deleteTool(id: string): Promise<void>;
  deployWorkflow(spec: WorkflowSpec, name: string): Promise<string>;
  getStatus(id: string): Promise<ComponentStatus>;
  healthCheck(): Promise<boolean>;
}

// ─────────────────────────────────────────────────────────────
// DifyBackendAdapter (wraps existing DifyApiAdapter)
// ─────────────────────────────────────────────────────────────

export class DifyBackendAdapter implements ComponentBackend {
  readonly backendType: BackendType = 'dify';
  private client: AxiosInstance;

  constructor(baseUrl: string, apiKey: string) {
    this.client = axios.create({
      baseURL: baseUrl,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 15_000,
    });
  }

  async registerTool(spec: ToolDSL): Promise<string> {
    const endpoint =
      spec.spec.type === 'mcp'
        ? '/v1/workspaces/current/tool-providers/mcp'
        : '/v1/workspaces/current/tool-providers/api';
    const res = await this.client.post(endpoint, spec);
    return res.data.id as string;
  }

  async updateTool(id: string, spec: ToolDSL): Promise<void> {
    await this.client.put(`/v1/workspaces/current/tool-providers/${id}`, spec);
  }

  async deleteTool(id: string): Promise<void> {
    await this.client.delete(`/v1/workspaces/current/tool-providers/${id}`);
  }

  async deployWorkflow(spec: WorkflowSpec, name: string): Promise<string> {
    const res = await this.client.post('/v1/workspaces/current/workflows', { name, spec });
    return res.data.id as string;
  }

  async getStatus(id: string): Promise<ComponentStatus> {
    const res = await this.client.get(`/v1/workspaces/current/tool-providers/${id}`);
    const d = res.data as Record<string, unknown>;
    return {
      id: d.id as string,
      name: d.name as string,
      version: (d.version as string) ?? '1.0.0',
      state: 'active',
      updatedAt: new Date(d.updated_at as string),
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.get('/v1/info');
      return true;
    } catch {
      return false;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// LangflowBackendAdapter
// ─────────────────────────────────────────────────────────────

export class LangflowBackendAdapter implements ComponentBackend {
  readonly backendType: BackendType = 'langflow';
  private client: AxiosInstance;

  constructor(baseUrl: string, apiKey?: string) {
    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
    });
  }

  async registerTool(spec: ToolDSL): Promise<string> {
    // Langflow doesn't have a native "tool provider" concept —
    // we wrap the tool as a Custom Component flow with a single node.
    const flow = this._toolDslToLangflowFlow(spec);
    const res = await this.client.post('/api/v1/flows/', flow);
    return (res.data as Record<string, unknown>).id as string;
  }

  async updateTool(id: string, spec: ToolDSL): Promise<void> {
    const flow = this._toolDslToLangflowFlow(spec);
    await this.client.put(`/api/v1/flows/${id}`, flow);
  }

  async deleteTool(id: string): Promise<void> {
    await this.client.delete(`/api/v1/flows/${id}`);
  }

  async deployWorkflow(spec: WorkflowSpec, name: string): Promise<string> {
    const flow = this._workflowSpecToLangflowFlow(spec, name);
    const res = await this.client.post('/api/v1/flows/', flow);
    return (res.data as Record<string, unknown>).id as string;
  }

  async getStatus(id: string): Promise<ComponentStatus> {
    const res = await this.client.get(`/api/v1/flows/${id}`);
    const d = res.data as Record<string, unknown>;
    return {
      id: d.id as string,
      name: d.name as string,
      version: '1.0.0',
      state: 'active',
      updatedAt: new Date(d.updated_at as string ?? Date.now()),
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.get('/api/v1/health');
      return true;
    } catch {
      return false;
    }
  }

  private _toolDslToLangflowFlow(spec: ToolDSL): Record<string, unknown> {
    return {
      name: spec.metadata.name,
      description: spec.metadata.description ?? '',
      data: {
        nodes: [
          {
            id: 'tool-node',
            type: 'CustomComponent',
            data: {
              type: spec.spec.type,
              server: spec.spec.server,
              endpoints: spec.spec.endpoints ?? [],
              tools: spec.spec.tools ?? [],
            },
          },
        ],
        edges: [],
      },
    };
  }

  private _workflowSpecToLangflowFlow(spec: WorkflowSpec, name: string): Record<string, unknown> {
    const nodes = spec.steps.map((step, i) => ({
      id: step.id,
      type: step.kind,
      position: { x: 200 * i, y: 200 },
      data: step.config,
    }));

    const edges = spec.steps
      .filter((s) => s.dependsOn)
      .flatMap((s) =>
        (s.dependsOn ?? []).map((dep) => ({
          id: `${dep}->${s.id}`,
          source: dep,
          target: s.id,
        })),
      );

    return { name, description: '', data: { nodes, edges } };
  }
}

// ─────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────

export interface BackendConfig {
  type: BackendType;
  baseUrl: string;
  apiKey?: string;
}

export function createBackend(config: BackendConfig): ComponentBackend {
  switch (config.type) {
    case 'dify':
      return new DifyBackendAdapter(config.baseUrl, config.apiKey ?? '');
    case 'langflow':
      return new LangflowBackendAdapter(config.baseUrl, config.apiKey);
    default:
      throw new Error(`Unsupported backend type: ${config.type}`);
  }
}
