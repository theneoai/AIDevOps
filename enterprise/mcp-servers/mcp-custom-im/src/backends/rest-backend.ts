import axios, { AxiosInstance } from 'axios';
import {
  IMBackend,
  SendMessageParams,
  SendNotificationParams,
  SendResult,
  RestBackendConfig,
  RestEndpointConfig,
} from './types';

/**
 * RestBackend — delivers messages by calling a configured REST API.
 *
 * Supports auth: none | bearer | api_key | basic
 * Endpoint paths and body templates are configurable per backend.
 *
 * Works with enterprise OA systems, Teams/Slack REST APIs, custom gateways.
 */
export class RestBackend implements IMBackend {
  readonly name: string;
  readonly type = 'rest' as const;

  private baseUrl: string;
  private cfg: RestBackendConfig;
  private client: AxiosInstance;

  constructor(cfg: RestBackendConfig) {
    this.name = cfg.name;
    this.baseUrl = interpolateEnv(cfg.baseUrl);
    this.cfg = cfg;
    this.client = this.buildClient(cfg);
  }

  async sendMessage(params: SendMessageParams): Promise<SendResult> {
    const ep = this.cfg.endpoints.sendMessage;
    const body = this.buildBody(ep, {
      channelId: params.channelId,
      text: params.text,
      title: params.title ?? '',
      format: params.format ?? 'text',
      fields: params.fields ?? {},
    });

    const res = await this.client.request({
      method: ep.method,
      url: `${this.baseUrl}${interpolateEnv(ep.path)}`,
      data: body,
    });

    const messageId = this.cfg.messageIdPath
      ? getNestedValue(res.data as Record<string, unknown>, this.cfg.messageIdPath)
      : undefined;

    return { success: true, messageId, backend: this.name, channelId: params.channelId };
  }

  async sendNotification(params: SendNotificationParams): Promise<SendResult> {
    const channelId = params.channelId ?? 'default';
    const ep = this.cfg.endpoints.sendNotification ?? this.cfg.endpoints.sendMessage;
    const body = this.buildBody(ep, {
      channelId,
      text: params.body,
      title: params.title,
      level: params.level ?? 'info',
      recipients: params.recipients ?? [],
    });

    const res = await this.client.request({
      method: ep.method,
      url: `${this.baseUrl}${interpolateEnv(ep.path)}`,
      data: body,
    });

    const messageId = this.cfg.messageIdPath
      ? getNestedValue(res.data as Record<string, unknown>, this.cfg.messageIdPath)
      : undefined;

    return { success: true, messageId, backend: this.name, channelId };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.get(`${this.baseUrl}/health`, { timeout: 3_000 });
      return true;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response && err.response.status < 500) return true;
      return false;
    }
  }

  private buildClient(cfg: RestBackendConfig): AxiosInstance {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (cfg.auth) {
      const token = interpolateEnv(cfg.auth.token ?? '');
      switch (cfg.auth.type) {
        case 'bearer':
          headers['Authorization'] = `Bearer ${token}`;
          break;
        case 'api_key':
          headers[cfg.auth.headerName ?? 'X-API-Key'] = token;
          break;
        case 'basic': {
          const user = interpolateEnv(cfg.auth.username ?? '');
          const pass = interpolateEnv(cfg.auth.password ?? '');
          headers['Authorization'] = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
          break;
        }
      }
    }

    return axios.create({ baseURL: this.baseUrl, headers, timeout: 10_000 });
  }

  private buildBody(
    ep: RestEndpointConfig,
    vars: Record<string, unknown>,
  ): Record<string, unknown> {
    if (ep.bodyTemplate) {
      return substituteTemplate(ep.bodyTemplate, vars);
    }
    // Default body when no template is provided
    return vars;
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function interpolateEnv(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] ?? '');
}

function substituteTemplate(
  template: Record<string, unknown>,
  vars: Record<string, unknown>,
): Record<string, unknown> {
  const str = JSON.stringify(template);
  const substituted = str.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    vars[key] !== undefined ? String(vars[key]) : '',
  );
  return JSON.parse(substituted) as Record<string, unknown>;
}

function getNestedValue(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur != null ? String(cur) : undefined;
}
