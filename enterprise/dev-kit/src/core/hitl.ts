/**
 * Human-in-the-Loop (HITL) Approval Engine
 *
 * Provides a runtime engine for workflow approval gates.
 * When a workflow reaches an HITL step, execution pauses and an approval
 * request is dispatched through the configured notification channel.
 *
 * Architecture:
 *   WorkflowRunner encounters HITLStep
 *     → HITLEngine.requestApproval(request)
 *     → NotificationAdapter.send(channel, message)
 *     → Poll for decision OR wait for webhook callback
 *     → HITLEngine.resolveApproval(requestId, decision)
 *     → WorkflowRunner resumes with 'approved' or 'rejected'
 *
 * Supported notification channels:
 *   - webhook:  POST to external URL; callback URL provided for response
 *   - slack:    Posts to Slack channel via Incoming Webhook
 *   - email:    Sends via SMTP / SendGrid (requires env config)
 *   - console:  Development fallback – prompts in terminal
 *
 * Production note:
 *   For long-running approvals, use a durable store (Redis, PostgreSQL)
 *   for the pending requests map instead of the in-process Map used here.
 */

import { EventEmitter } from 'events';
import { createLogger } from './observability';

const log = createLogger('hitl');

// ─────────────────────────────────────────────────────────────
// Core Types
// ─────────────────────────────────────────────────────────────

export type ApprovalDecision = 'approved' | 'rejected';

export type HITLChannel = 'slack' | 'email' | 'webhook' | 'console';

export interface ApprovalRequest {
  /** Unique request identifier */
  id: string;
  /** Workflow session / run id */
  sessionId: string;
  /** Workflow name */
  workflowName: string;
  /** Step id within the workflow */
  stepId: string;
  /** Rendered message to show to approver */
  message: string;
  /** Notification channel */
  channel: HITLChannel;
  /** Approver identifiers (email, slack user, etc.) */
  approvers?: string[];
  /** Timestamp when request was created */
  createdAt: Date;
  /** Timestamp when request expires */
  expiresAt?: Date;
  /** Channel-specific metadata */
  channelConfig?: Record<string, unknown>;
}

export interface ApprovalResult {
  requestId: string;
  decision: ApprovalDecision;
  decidedBy?: string;
  decidedAt: Date;
  comment?: string;
}

export interface HITLEngineOptions {
  /** Default timeout in seconds (default: 3600 = 1 hour) */
  defaultTimeoutSeconds?: number;
  /** Action on timeout: 'approve' | 'reject' | 'error' (default: 'error') */
  defaultOnTimeout?: 'approve' | 'reject' | 'error';
  /** Slack incoming webhook URL */
  slackWebhookUrl?: string;
  /** Callback base URL for webhook channel (e.g. "https://myapp.com/hitl") */
  callbackBaseUrl?: string;
  /** SMTP config for email channel */
  smtp?: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
  };
}

// ─────────────────────────────────────────────────────────────
// Notification Adapters
// ─────────────────────────────────────────────────────────────

interface NotificationPayload {
  request: ApprovalRequest;
  approveUrl: string;
  rejectUrl: string;
}

async function sendConsoleNotification(payload: NotificationPayload): Promise<void> {
  console.log('\n' + '═'.repeat(60));
  console.log('  APPROVAL REQUIRED');
  console.log('═'.repeat(60));
  console.log(`  Request ID : ${payload.request.id}`);
  console.log(`  Workflow   : ${payload.request.workflowName}`);
  console.log(`  Step       : ${payload.request.stepId}`);
  console.log(`  Message    : ${payload.request.message}`);
  console.log('─'.repeat(60));
  console.log(`  Approve URL: ${payload.approveUrl}`);
  console.log(`  Reject URL : ${payload.rejectUrl}`);
  console.log('═'.repeat(60) + '\n');
}

async function sendSlackNotification(
  payload: NotificationPayload,
  webhookUrl: string
): Promise<void> {
  const body = {
    text: `*Approval Required* — ${payload.request.workflowName}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '⏸  Workflow Approval Required' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Workflow:*\n${payload.request.workflowName}` },
          { type: 'mrkdwn', text: `*Step:*\n${payload.request.stepId}` },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Message:*\n${payload.request.message}` },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Approve' },
            style: 'primary',
            url: payload.approveUrl,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '❌ Reject' },
            style: 'danger',
            url: payload.rejectUrl,
          },
        ],
      },
    ],
  };

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    log.error('Slack notification failed', { error: String(err) });
    throw err;
  }
}

async function sendWebhookNotification(
  payload: NotificationPayload,
  webhookUrl: string
): Promise<void> {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'hitl_approval_request',
        request: payload.request,
        approveUrl: payload.approveUrl,
        rejectUrl: payload.rejectUrl,
      }),
    });
  } catch (err) {
    log.error('Webhook notification failed', { error: String(err) });
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
// HITL Engine
// ─────────────────────────────────────────────────────────────

export class HITLEngine extends EventEmitter {
  private pending: Map<string, {
    request: ApprovalRequest;
    resolve: (result: ApprovalResult) => void;
    reject: (err: Error) => void;
    timer?: ReturnType<typeof setTimeout>;
  }> = new Map();

  private options: Required<HITLEngineOptions>;

  constructor(options: HITLEngineOptions = {}) {
    super();
    this.options = {
      defaultTimeoutSeconds: options.defaultTimeoutSeconds ?? 3600,
      defaultOnTimeout: options.defaultOnTimeout ?? 'error',
      slackWebhookUrl: options.slackWebhookUrl ?? '',
      callbackBaseUrl: options.callbackBaseUrl ?? 'http://localhost:3000/hitl',
      smtp: options.smtp ?? { host: '', port: 587, user: '', pass: '', from: '' },
    };
  }

  // ── Request Approval ─────────────────────────────────────

  async requestApproval(
    request: Omit<ApprovalRequest, 'id' | 'createdAt' | 'expiresAt'>,
    timeoutSeconds?: number
  ): Promise<ApprovalResult> {
    const id = `hitl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timeoutSecs = timeoutSeconds ?? this.options.defaultTimeoutSeconds;
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + timeoutSecs * 1000);

    const fullRequest: ApprovalRequest = {
      ...request,
      id,
      createdAt,
      expiresAt,
    };

    log.info('HITL approval requested', {
      requestId: id,
      workflowName: request.workflowName,
      stepId: request.stepId,
      channel: request.channel,
    });

    return new Promise<ApprovalResult>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;

      if (timeoutSecs > 0) {
        timer = setTimeout(() => {
          const entry = this.pending.get(id);
          if (!entry) return;

          this.pending.delete(id);
          const action = this.options.defaultOnTimeout;

          if (action === 'error') {
            reject(new Error(`HITL approval timed out after ${timeoutSecs}s (step: ${request.stepId})`));
          } else {
            resolve({
              requestId: id,
              decision: action === 'approve' ? 'approved' : 'rejected',
              decidedBy: 'timeout',
              decidedAt: new Date(),
              comment: `Auto-${action}d after timeout`,
            });
          }
        }, timeoutSecs * 1000);
      }

      this.pending.set(id, { request: fullRequest, resolve, reject, timer });

      // Send notification (fire and forget – errors are logged but don't block)
      this.sendNotification(fullRequest).catch(err => {
        log.error('Failed to send HITL notification', { requestId: id, error: String(err) });
      });

      this.emit('approval_requested', fullRequest);
    });
  }

  // ── Resolve Approval ─────────────────────────────────────

  resolveApproval(
    requestId: string,
    decision: ApprovalDecision,
    decidedBy?: string,
    comment?: string
  ): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) {
      log.warn('resolveApproval called for unknown request', { requestId });
      return false;
    }

    clearTimeout(entry.timer);
    this.pending.delete(requestId);

    const result: ApprovalResult = {
      requestId,
      decision,
      decidedBy,
      decidedAt: new Date(),
      comment,
    };

    log.info('HITL approval resolved', { requestId, decision, decidedBy });
    this.emit('approval_resolved', result);
    entry.resolve(result);
    return true;
  }

  // ── List Pending ─────────────────────────────────────────

  listPending(): ApprovalRequest[] {
    return Array.from(this.pending.values()).map(e => e.request);
  }

  // ── Private: Send Notification ───────────────────────────

  private async sendNotification(request: ApprovalRequest): Promise<void> {
    const approveUrl = `${this.options.callbackBaseUrl}/approve/${request.id}`;
    const rejectUrl = `${this.options.callbackBaseUrl}/reject/${request.id}`;
    const payload: NotificationPayload = { request, approveUrl, rejectUrl };

    switch (request.channel) {
      case 'console':
        await sendConsoleNotification(payload);
        break;

      case 'slack':
        const slackUrl = (request.channelConfig?.slack_channel as string) || this.options.slackWebhookUrl;
        if (!slackUrl) throw new Error('Slack webhook URL not configured');
        await sendSlackNotification(payload, slackUrl);
        break;

      case 'webhook':
        const webhookUrl = (request.channelConfig?.webhook_url as string);
        if (!webhookUrl) throw new Error('Webhook URL not provided in step config');
        await sendWebhookNotification(payload, webhookUrl);
        break;

      case 'email':
        // Email requires SMTP — log placeholder for now
        log.info('Email HITL notification (configure SMTP in options)', {
          to: request.approvers,
          subject: `Approval Required: ${request.workflowName}`,
        });
        break;

      default:
        log.warn('Unknown HITL channel', { channel: request.channel });
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Express Callback Router (for webhook channel)
// ─────────────────────────────────────────────────────────────

/**
 * Attach HITL callback routes to an Express app.
 *
 * POST /hitl/approve/:requestId  → resolves with 'approved'
 * POST /hitl/reject/:requestId   → resolves with 'rejected'
 * GET  /hitl/pending             → lists pending requests
 */
export function attachHITLRoutes(
  app: { post: Function; get: Function },
  engine: HITLEngine,
  basePath = '/hitl'
): void {
  app.post(`${basePath}/approve/:requestId`, (req: Record<string, unknown>, res: { json: Function; status: Function }) => {
    const { requestId } = req.params as { requestId: string };
    const body = req.body as { decidedBy?: string; comment?: string } | undefined;
    const success = engine.resolveApproval(requestId, 'approved', body?.decidedBy, body?.comment);
    if (success) {
      res.json({ status: 'approved', requestId });
    } else {
      res.status(404).json({ error: 'Request not found or already resolved' });
    }
  });

  app.post(`${basePath}/reject/:requestId`, (req: Record<string, unknown>, res: { json: Function; status: Function }) => {
    const { requestId } = req.params as { requestId: string };
    const body = req.body as { decidedBy?: string; comment?: string } | undefined;
    const success = engine.resolveApproval(requestId, 'rejected', body?.decidedBy, body?.comment);
    if (success) {
      res.json({ status: 'rejected', requestId });
    } else {
      res.status(404).json({ error: 'Request not found or already resolved' });
    }
  });

  app.get(`${basePath}/pending`, (_req: unknown, res: { json: Function }) => {
    res.json({ pending: engine.listPending() });
  });
}

// ─────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────

let _engine: HITLEngine | null = null;

export function getHITLEngine(options?: HITLEngineOptions): HITLEngine {
  if (!_engine) {
    _engine = new HITLEngine({
      slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
      callbackBaseUrl: process.env.HITL_CALLBACK_BASE_URL ?? 'http://localhost:3100/hitl',
      defaultTimeoutSeconds: parseInt(process.env.HITL_DEFAULT_TIMEOUT ?? '3600', 10),
      ...options,
    });
  }
  return _engine;
}
