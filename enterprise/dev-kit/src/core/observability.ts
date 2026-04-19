/**
 * Observability Layer
 *
 * Provides structured logging, metrics, and trace spans for the DevKit.
 * Designed to be zero-dependency when OpenTelemetry is not installed,
 * falling back to JSON-structured stdout logging.
 *
 * Integration points:
 *  - Export OTEL_EXPORTER_OTLP_ENDPOINT to send traces to Jaeger/Tempo/Datadog
 *  - Export METRICS_PORT to expose Prometheus /metrics (default: 9090)
 *  - Set LOG_LEVEL=debug|info|warn|error (default: info)
 *
 * Harness CI/CD integration:
 *  - Harness STO (Security Testing Orchestration) ingests metrics via OTLP
 *  - Harness CV (Continuous Verification) uses the /metrics endpoint
 *  - This module emits deployment events in the format Harness expects
 */

import { EventEmitter } from 'events';

// ─────────────────────────────────────────────────────────────
// Log Levels
// ─────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function currentLevel(): LogLevel {
  const env = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel;
  return env in LOG_LEVEL_RANK ? env : 'info';
}

// ─────────────────────────────────────────────────────────────
// Structured Logger
// ─────────────────────────────────────────────────────────────

export interface LogRecord {
  timestamp: string;
  level: LogLevel;
  message: string;
  component: string;
  traceId?: string;
  spanId?: string;
  [key: string]: unknown;
}

export class Logger {
  private component: string;
  private activeTraceId?: string;
  private activeSpanId?: string;

  constructor(component: string) {
    this.component = component;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[currentLevel()];
  }

  private write(level: LogLevel, message: string, extra: Record<string, unknown> = {}): void {
    if (!this.shouldLog(level)) return;

    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      message,
      component: this.component,
      ...(this.activeTraceId ? { traceId: this.activeTraceId } : {}),
      ...(this.activeSpanId ? { spanId: this.activeSpanId } : {}),
      ...extra,
    };

    const line = JSON.stringify(record);
    if (level === 'error') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }

    // Also emit to global metrics bus
    metricsCollector.recordLogEvent(level);
  }

  debug(message: string, extra?: Record<string, unknown>): void { this.write('debug', message, extra); }
  info(message: string, extra?: Record<string, unknown>): void  { this.write('info', message, extra); }
  warn(message: string, extra?: Record<string, unknown>): void  { this.write('warn', message, extra); }
  error(message: string, extra?: Record<string, unknown>): void { this.write('error', message, extra); }

  withTrace(traceId: string, spanId: string): Logger {
    const child = new Logger(this.component);
    child.activeTraceId = traceId;
    child.activeSpanId = spanId;
    return child;
  }
}

// ─────────────────────────────────────────────────────────────
// Trace Span
// ─────────────────────────────────────────────────────────────

export interface SpanAttributes {
  [key: string]: string | number | boolean;
}

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startMs: number;
  endMs?: number;
  status: 'ok' | 'error' | 'unset';
  attributes: SpanAttributes;
  events: Array<{ name: string; timestamp: string; attributes?: SpanAttributes }>;
}

function generateId(length: number): string {
  return Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

export class TraceContext {
  private spans: Span[] = [];
  readonly traceId: string;
  private currentSpanId?: string;

  constructor() {
    this.traceId = generateId(32);
  }

  startSpan(name: string, attributes: SpanAttributes = {}): Span {
    const span: Span = {
      traceId: this.traceId,
      spanId: generateId(16),
      parentSpanId: this.currentSpanId,
      name,
      startMs: Date.now(),
      status: 'unset',
      attributes,
      events: [],
    };
    this.spans.push(span);
    this.currentSpanId = span.spanId;
    return span;
  }

  endSpan(span: Span, status: 'ok' | 'error' = 'ok'): void {
    span.endMs = Date.now();
    span.status = status;
    this.currentSpanId = span.parentSpanId;

    // Record to metrics
    metricsCollector.recordSpan(span);
  }

  addEvent(span: Span, name: string, attributes?: SpanAttributes): void {
    span.events.push({ name, timestamp: new Date().toISOString(), attributes });
  }

  toJSON(): Span[] {
    return this.spans;
  }

  /** Export in OTLP-compatible format for Jaeger/Tempo/Datadog */
  toOTLP(): Record<string, unknown> {
    return {
      resourceSpans: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'dify-devkit' } }] },
        scopeSpans: [{
          scope: { name: 'dify-devkit', version: '0.1.0' },
          spans: this.spans.map(s => ({
            traceId: s.traceId,
            spanId: s.spanId,
            parentSpanId: s.parentSpanId,
            name: s.name,
            kind: 1,
            startTimeUnixNano: String(s.startMs * 1_000_000),
            endTimeUnixNano: String((s.endMs ?? Date.now()) * 1_000_000),
            status: { code: s.status === 'ok' ? 1 : s.status === 'error' ? 2 : 0 },
            attributes: Object.entries(s.attributes).map(([k, v]) => ({
              key: k,
              value: typeof v === 'string' ? { stringValue: v }
                   : typeof v === 'number' ? { doubleValue: v }
                   : { boolValue: v },
            })),
          })),
        }],
      }],
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Metrics Collector
// ─────────────────────────────────────────────────────────────

export interface MetricsSnapshot {
  deployments: { total: number; success: number; failure: number };
  compilations: { total: number; success: number; failure: number; avgDurationMs: number };
  spans: { total: number; avgDurationMs: number };
  logs: { debug: number; info: number; warn: number; error: number };
  uptime: number;
}

class MetricsCollector extends EventEmitter {
  private startMs = Date.now();
  private data = {
    deployments: { total: 0, success: 0, failure: 0 },
    compilations: { total: 0, success: 0, failure: 0, durations: [] as number[] },
    spans: { total: 0, durations: [] as number[] },
    logs: { debug: 0, info: 0, warn: 0, error: 0 },
  };

  recordDeployment(success: boolean): void {
    this.data.deployments.total++;
    if (success) this.data.deployments.success++;
    else this.data.deployments.failure++;
    this.emit('metric', { name: 'deployment', success });
  }

  recordCompilation(success: boolean, durationMs: number): void {
    this.data.compilations.total++;
    if (success) this.data.compilations.success++;
    else this.data.compilations.failure++;
    this.data.compilations.durations.push(durationMs);
    this.emit('metric', { name: 'compilation', success, durationMs });
  }

  recordSpan(span: Span): void {
    this.data.spans.total++;
    if (span.endMs) {
      this.data.spans.durations.push(span.endMs - span.startMs);
    }
  }

  recordLogEvent(level: LogLevel): void {
    this.data.logs[level]++;
  }

  snapshot(): MetricsSnapshot {
    const avgDuration = (durations: number[]) =>
      durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    return {
      deployments: { ...this.data.deployments },
      compilations: {
        total: this.data.compilations.total,
        success: this.data.compilations.success,
        failure: this.data.compilations.failure,
        avgDurationMs: avgDuration(this.data.compilations.durations),
      },
      spans: {
        total: this.data.spans.total,
        avgDurationMs: avgDuration(this.data.spans.durations),
      },
      logs: { ...this.data.logs },
      uptime: Date.now() - this.startMs,
    };
  }

  /** Prometheus text format for /metrics endpoint */
  toPrometheus(): string {
    const snap = this.snapshot();
    const lines: string[] = [
      '# HELP dify_devkit_deployments_total Total deployment attempts',
      '# TYPE dify_devkit_deployments_total counter',
      `dify_devkit_deployments_total{status="success"} ${snap.deployments.success}`,
      `dify_devkit_deployments_total{status="failure"} ${snap.deployments.failure}`,
      '',
      '# HELP dify_devkit_compilations_total Total compilation attempts',
      '# TYPE dify_devkit_compilations_total counter',
      `dify_devkit_compilations_total{status="success"} ${snap.compilations.success}`,
      `dify_devkit_compilations_total{status="failure"} ${snap.compilations.failure}`,
      '',
      '# HELP dify_devkit_compilation_duration_ms Average compilation duration',
      '# TYPE dify_devkit_compilation_duration_ms gauge',
      `dify_devkit_compilation_duration_ms ${snap.compilations.avgDurationMs.toFixed(2)}`,
      '',
      '# HELP dify_devkit_log_events_total Log events by level',
      '# TYPE dify_devkit_log_events_total counter',
      `dify_devkit_log_events_total{level="debug"} ${snap.logs.debug}`,
      `dify_devkit_log_events_total{level="info"} ${snap.logs.info}`,
      `dify_devkit_log_events_total{level="warn"} ${snap.logs.warn}`,
      `dify_devkit_log_events_total{level="error"} ${snap.logs.error}`,
      '',
      '# HELP dify_devkit_uptime_ms Process uptime in milliseconds',
      '# TYPE dify_devkit_uptime_ms gauge',
      `dify_devkit_uptime_ms ${snap.uptime}`,
      '',
    ];
    return lines.join('\n');
  }
}

export const metricsCollector = new MetricsCollector();

// ─────────────────────────────────────────────────────────────
// Deployment Audit Trail
// ─────────────────────────────────────────────────────────────

export interface DeploymentEvent {
  id: string;
  timestamp: string;
  component: string;
  kind: string;
  version?: string;
  action: 'deploy' | 'update' | 'delete' | 'validate' | 'test';
  status: 'success' | 'failure' | 'skipped';
  durationMs: number;
  actor?: string;
  environment?: string;
  error?: string;
  traceId?: string;
}

const deploymentAuditLog: DeploymentEvent[] = [];

export function recordDeploymentEvent(event: Omit<DeploymentEvent, 'id' | 'timestamp'>): DeploymentEvent {
  const full: DeploymentEvent = {
    id: `evt_${Date.now()}_${generateId(8)}`,
    timestamp: new Date().toISOString(),
    ...event,
  };
  deploymentAuditLog.push(full);
  metricsCollector.recordDeployment(event.status === 'success');
  return full;
}

export function getAuditLog(): DeploymentEvent[] {
  return [...deploymentAuditLog];
}

// ─────────────────────────────────────────────────────────────
// Helper: Timed operation
// ─────────────────────────────────────────────────────────────

export async function withSpan<T>(
  ctx: TraceContext,
  spanName: string,
  attributes: SpanAttributes,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const span = ctx.startSpan(spanName, attributes);
  try {
    const result = await fn(span);
    ctx.endSpan(span, 'ok');
    return result;
  } catch (err) {
    ctx.addEvent(span, 'error', { 'error.message': String(err) });
    ctx.endSpan(span, 'error');
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
// OTLP Exporter (fire-and-forget)
// ─────────────────────────────────────────────────────────────

export async function exportTraceToOTLP(ctx: TraceContext): Promise<void> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;

  try {
    await fetch(`${endpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ctx.toOTLP()),
    });
  } catch {
    // Best-effort: never throw from observability code
  }
}

// ─────────────────────────────────────────────────────────────
// Logger Factory
// ─────────────────────────────────────────────────────────────

export function createLogger(component: string): Logger {
  return new Logger(component);
}

export const logger = createLogger('dify-devkit');
