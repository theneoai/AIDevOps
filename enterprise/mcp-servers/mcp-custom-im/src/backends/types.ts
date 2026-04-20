/**
 * IMBackend interface — implement this to add a new IM backend.
 *
 * Each backend maps to one IM system (webhook endpoint, REST API, etc.).
 * The IMClient selects the backend per message based on channel routing rules.
 */

export type MessageFormat = 'text' | 'markdown' | 'html' | 'card';
export type AuthType = 'none' | 'bearer' | 'api_key' | 'basic' | 'hmac_sha256';
export type BackendType = 'webhook' | 'rest';

export interface SendMessageParams {
  channelId: string;
  text: string;
  format?: MessageFormat;
  title?: string;
  /** Arbitrary key-value fields for rich/card messages */
  fields?: Record<string, string>;
}

export interface SendNotificationParams {
  title: string;
  body: string;
  level?: 'info' | 'warning' | 'error' | 'success';
  recipients?: string[];
  /** Channel to deliver to (overrides routing) */
  channelId?: string;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  backend: string;
  channelId: string;
}

export interface IMBackend {
  readonly name: string;
  readonly type: BackendType;

  sendMessage(params: SendMessageParams): Promise<SendResult>;
  sendNotification(params: SendNotificationParams): Promise<SendResult>;
  healthCheck(): Promise<boolean>;
}

// ─────────────────────────────────────────────────────────────
// Config Schema Types (matches im-config.json)
// ─────────────────────────────────────────────────────────────

export interface AuthConfig {
  type: AuthType;
  /** Bearer token / API key value (supports ${ENV_VAR} interpolation) */
  token?: string;
  /** Header name for api_key auth (default: X-API-Key) */
  headerName?: string;
  /** HMAC secret for hmac_sha256 auth */
  secret?: string;
  /** Basic auth username */
  username?: string;
  /** Basic auth password */
  password?: string;
}

export interface WebhookBackendConfig {
  name: string;
  type: 'webhook';
  /** Webhook URL (supports ${ENV_VAR} interpolation) */
  url: string;
  auth?: AuthConfig;
  /** How to format the JSON body sent to the webhook */
  messageFormat?: MessageFormat;
  /** Custom body template (Mustache-style: {{text}}, {{title}}, {{level}}) */
  bodyTemplate?: Record<string, unknown>;
  /** HTTP method (default: POST) */
  method?: 'POST' | 'PUT';
  /** Extra headers to include */
  extraHeaders?: Record<string, string>;
}

export interface RestEndpointConfig {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  path: string;
  /** Body template with {{text}}, {{channelId}}, {{title}}, etc. */
  bodyTemplate?: Record<string, unknown>;
}

export interface RestBackendConfig {
  name: string;
  type: 'rest';
  baseUrl: string;
  auth?: AuthConfig;
  endpoints: {
    sendMessage: RestEndpointConfig;
    sendNotification?: RestEndpointConfig;
  };
  /** JSON path to extract messageId from response (e.g. "data.id") */
  messageIdPath?: string;
}

export type BackendConfig = WebhookBackendConfig | RestBackendConfig;

export interface RoutingRule {
  /** Channel ID pattern (glob: "urgent:*", "team-*", or exact match) */
  pattern: string;
  /** Backend name to route to */
  backend: string;
}

export interface IMConfig {
  backends: BackendConfig[];
  /** Default backend name when no routing rule matches */
  defaultBackend: string;
  /** Channel routing rules (evaluated in order, first match wins) */
  routes?: RoutingRule[];
  /** Default channel ID when none is specified */
  defaultChannel?: string;
}
