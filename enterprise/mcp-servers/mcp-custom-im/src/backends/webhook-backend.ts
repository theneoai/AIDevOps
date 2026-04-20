import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import {
  IMBackend,
  SendMessageParams,
  SendNotificationParams,
  SendResult,
  WebhookBackendConfig,
  AuthConfig,
} from './types';

/**
 * WebhookBackend — delivers messages by POSTing JSON to a configurable URL.
 *
 * Supports auth strategies: none | bearer | api_key | basic | hmac_sha256
 * Body is built from bodyTemplate (with {{var}} substitution) or auto-generated.
 *
 * Works out of the box with:
 *   - DingTalk custom robot webhooks
 *   - Slack incoming webhooks
 *   - Generic enterprise notification endpoints
 *   - Any HTTP webhook receiver
 */
export class WebhookBackend implements IMBackend {
  readonly name: string;
  readonly type = 'webhook' as const;

  private url: string;
  private auth?: AuthConfig;
  private bodyTemplate?: Record<string, unknown>;
  private method: 'POST' | 'PUT';
  private extraHeaders: Record<string, string>;
  private client: AxiosInstance;

  constructor(cfg: WebhookBackendConfig) {
    this.name = cfg.name;
    this.url = interpolateEnv(cfg.url);
    this.auth = cfg.auth;
    this.bodyTemplate = cfg.bodyTemplate;
    this.method = cfg.method ?? 'POST';
    this.extraHeaders = cfg.extraHeaders ?? {};
    this.client = axios.create({ timeout: 10_000 });
  }

  async sendMessage(params: SendMessageParams): Promise<SendResult> {
    const body = this.buildBody({
      text: params.text,
      title: params.title ?? '',
      channelId: params.channelId,
      level: 'info',
      format: params.format ?? 'text',
      fields: params.fields ?? {},
    });

    const headers = await this.buildHeaders(body);
    await this.client.request({
      method: this.method,
      url: this.url,
      data: body,
      headers,
    });

    return { success: true, backend: this.name, channelId: params.channelId };
  }

  async sendNotification(params: SendNotificationParams): Promise<SendResult> {
    const channelId = params.channelId ?? 'default';
    const body = this.buildBody({
      text: params.body,
      title: params.title,
      channelId,
      level: params.level ?? 'info',
      format: 'markdown',
      fields: {},
      recipients: params.recipients ?? [],
    });

    const headers = await this.buildHeaders(body);
    await this.client.request({
      method: this.method,
      url: this.url,
      data: body,
      headers,
    });

    return { success: true, backend: this.name, channelId };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.get(this.url, { timeout: 3_000 });
      return true;
    } catch (err) {
      // Webhook URLs often return 405 on GET — treat as reachable
      if (axios.isAxiosError(err) && err.response?.status === 405) return true;
      return false;
    }
  }

  private buildBody(vars: Record<string, unknown>): Record<string, unknown> {
    if (this.bodyTemplate) {
      return substituteTemplate(this.bodyTemplate, vars);
    }

    // Auto-generate a sensible default body
    const { text, title, level, format } = vars;
    return {
      msgtype: format === 'markdown' ? 'markdown' : 'text',
      text: format !== 'markdown' ? { content: text } : undefined,
      markdown: format === 'markdown' ? { title: title || level, text } : undefined,
    };
  }

  private async buildHeaders(
    body: Record<string, unknown>,
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.extraHeaders,
    };

    if (!this.auth || this.auth.type === 'none') return headers;

    const token = this.auth.token ? interpolateEnv(this.auth.token) : '';

    switch (this.auth.type) {
      case 'bearer':
        headers['Authorization'] = `Bearer ${token}`;
        break;

      case 'api_key':
        headers[this.auth.headerName ?? 'X-API-Key'] = token;
        break;

      case 'basic': {
        const user = interpolateEnv(this.auth.username ?? '');
        const pass = interpolateEnv(this.auth.password ?? '');
        headers['Authorization'] = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
        break;
      }

      case 'hmac_sha256': {
        // Common pattern: sign the body with HMAC-SHA256, put in header
        const secret = interpolateEnv(this.auth.secret ?? '');
        const bodyStr = JSON.stringify(body);
        const timestamp = Date.now().toString();
        const sign = crypto
          .createHmac('sha256', secret)
          .update(`${timestamp}\n${bodyStr}`)
          .digest('base64');
        headers['X-Timestamp'] = timestamp;
        headers['X-Signature'] = sign;
        break;
      }
    }

    return headers;
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
