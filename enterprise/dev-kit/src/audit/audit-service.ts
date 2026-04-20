import { Pool } from 'pg';

export interface AuditEvent {
  event_type:
    | 'component.deploy'
    | 'tool.invoke'
    | 'credential.change'
    | 'user.login'
    | 'user.logout'
    | 'rbac.change'
    | 'policy.violation';
  actor_id: string;
  actor_role?: string;
  tenant_id?: string;
  resource?: string;
  action: string;
  result: 'success' | 'failure' | 'denied';
  metadata?: Record<string, unknown>;
}

export class AuditService {
  constructor(private pool: Pool) {}

  async log(event: AuditEvent): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO audit_logs
           (event_type, actor_id, actor_role, tenant_id, resource, action, result, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          event.event_type,
          event.actor_id,
          event.actor_role ?? null,
          event.tenant_id ?? null,
          event.resource ?? null,
          event.action,
          event.result,
          event.metadata ? JSON.stringify(event.metadata) : null,
        ]
      );
    } catch (err) {
      // Audit failures must NEVER break the main request path.
      // In production, route to a dead-letter queue or secondary log sink.
      console.error('[AuditService] Failed to write audit log:', err);
    }
  }

  async query(options: {
    actor_id?: string;
    tenant_id?: string;
    event_type?: string;
    since?: Date;
    limit?: number;
  }): Promise<AuditEvent[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (options.actor_id) {
      conditions.push(`actor_id = $${idx++}`);
      params.push(options.actor_id);
    }
    if (options.tenant_id) {
      conditions.push(`tenant_id = $${idx++}`);
      params.push(options.tenant_id);
    }
    if (options.event_type) {
      conditions.push(`event_type = $${idx++}`);
      params.push(options.event_type);
    }
    if (options.since) {
      conditions.push(`created_at >= $${idx++}`);
      params.push(options.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit ?? 100;
    const result = await this.pool.query(
      `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ${limit}`,
      params
    );
    return result.rows as AuditEvent[];
  }
}

let _instance: AuditService | null = null;

export function getAuditService(): AuditService | null {
  if (!_instance && process.env.AUDIT_DB_HOST) {
    const pool = new Pool({
      host: process.env.AUDIT_DB_HOST,
      port: Number(process.env.AUDIT_DB_PORT ?? 5432),
      user: process.env.AUDIT_DB_USER ?? 'postgres',
      password: process.env.AUDIT_DB_PASSWORD,
      database: process.env.AUDIT_DB_NAME ?? 'enterprise',
    });
    _instance = new AuditService(pool);
  }
  return _instance;
}
