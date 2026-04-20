/**
 * IMClient — routes messages to the correct backend based on channel rules.
 *
 * Resolution order:
 *   1. Explicit routing rules (glob pattern match on channelId)
 *   2. defaultBackend in config
 *   3. First registered backend
 */

import { IMConfig, IMBackend, RoutingRule, SendMessageParams, SendNotificationParams, SendResult, BackendConfig } from './backends/types';
import { WebhookBackend } from './backends/webhook-backend';
import { RestBackend } from './backends/rest-backend';

export class IMClient {
  private backends: Map<string, IMBackend> = new Map();
  private routes: RoutingRule[];
  private defaultBackend: string;
  private defaultChannel: string;

  // Dynamically registered webhooks (via register_webhook MCP tool)
  private dynamicWebhooks: Map<string, IMBackend> = new Map();

  constructor(config: IMConfig) {
    this.routes = config.routes ?? [];
    this.defaultBackend = config.defaultBackend;
    this.defaultChannel = config.defaultChannel ?? 'default';

    for (const backendCfg of config.backends) {
      const backend = createBackend(backendCfg);
      this.backends.set(backendCfg.name, backend);
    }
  }

  sendMessage(params: SendMessageParams): Promise<SendResult> {
    const backend = this.resolveBackend(params.channelId);
    return backend.sendMessage(params);
  }

  sendNotification(params: SendNotificationParams): Promise<SendResult> {
    const channelId = params.channelId ?? this.defaultChannel;
    const backend = this.resolveBackend(channelId);
    return backend.sendNotification({ ...params, channelId });
  }

  sendRichMessage(params: {
    channelId: string;
    title: string;
    body: string;
    fields?: Record<string, string>;
    format?: 'markdown' | 'card';
  }): Promise<SendResult> {
    const backend = this.resolveBackend(params.channelId);
    return backend.sendMessage({
      channelId: params.channelId,
      text: params.body,
      title: params.title,
      format: params.format ?? 'markdown',
      fields: params.fields,
    });
  }

  registerWebhook(
    name: string,
    url: string,
    authType: 'none' | 'bearer' | 'api_key' | 'hmac_sha256',
    authValue?: string,
    bodyTemplate?: Record<string, unknown>,
  ): void {
    const backend = createBackend({
      name,
      type: 'webhook',
      url,
      auth:
        authType === 'none'
          ? { type: 'none' }
          : { type: authType, token: authValue },
      bodyTemplate,
    });
    this.dynamicWebhooks.set(name, backend);
  }

  listBackends(): Array<{ name: string; type: string; dynamic: boolean }> {
    const static_ = [...this.backends.values()].map((b) => ({
      name: b.name,
      type: b.type,
      dynamic: false,
    }));
    const dynamic = [...this.dynamicWebhooks.values()].map((b) => ({
      name: b.name,
      type: b.type,
      dynamic: true,
    }));
    return [...static_, ...dynamic];
  }

  async healthCheck(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    for (const [name, backend] of this.backends) {
      results[name] = await backend.healthCheck().catch(() => false);
    }
    return results;
  }

  private resolveBackend(channelId: string): IMBackend {
    // 1. Check dynamic webhooks by name
    if (this.dynamicWebhooks.has(channelId)) {
      return this.dynamicWebhooks.get(channelId)!;
    }

    // 2. Routing rules: glob pattern match
    for (const rule of this.routes) {
      if (matchGlob(rule.pattern, channelId)) {
        const backend = this.backends.get(rule.backend) ?? this.dynamicWebhooks.get(rule.backend);
        if (backend) return backend;
      }
    }

    // 3. Default backend
    const def = this.backends.get(this.defaultBackend);
    if (def) return def;

    // 4. First available
    const first = this.backends.values().next().value;
    if (first) return first as IMBackend;

    throw new Error('No IM backend configured');
  }
}

function createBackend(cfg: BackendConfig): IMBackend {
  if (cfg.type === 'webhook') return new WebhookBackend(cfg);
  if (cfg.type === 'rest') return new RestBackend(cfg);
  throw new Error(`Unknown backend type: ${(cfg as BackendConfig).type}`);
}

function matchGlob(pattern: string, value: string): boolean {
  if (!pattern.includes('*')) return pattern === value;
  const regexStr = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${regexStr}$`).test(value);
}
