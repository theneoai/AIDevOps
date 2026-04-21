/**
 * Quota Store — PostgreSQL-backed quota policy and usage cache.
 *
 * Schema (auto-created on startup):
 *   quota_policies   — per-workspace quota limits set by admins
 *   usage_snapshots  — time-series usage snapshots polled from Dify
 */
import { Pool, PoolClient } from 'pg';
import { config } from './config';
import { createLogger } from './logger';

const logger = createLogger('quota-store');

export type QuotaStatus = 'ok' | 'warning' | 'exceeded';

export interface QuotaPolicy {
  workspaceId: string;
  workspaceName: string;
  /** Maximum team members. null = unlimited */
  maxMembers: number | null;
  /** Maximum number of apps */
  maxApps: number | null;
  /** Maximum knowledge bases */
  maxKnowledgeBases: number | null;
  /** Monthly token budget. null = unlimited */
  maxMonthlyTokens: number | null;
  /** Monthly workflow run budget. null = unlimited */
  maxMonthlyWorkflowRuns: number | null;
  /** Percentage of limit at which a warning alert fires (default 80) */
  warningThresholdPct: number;
  updatedAt: Date;
}

export interface UsageSnapshot {
  workspaceId: string;
  memberCount: number;
  appCount: number;
  knowledgeBaseCount: number;
  monthlyTokens: number;
  monthlyWorkflowRuns: number;
  snapshotAt: Date;
}

export interface QuotaReport {
  policy: QuotaPolicy;
  usage: UsageSnapshot | null;
  status: QuotaStatus;
  violations: string[];
  warnings: string[];
}

export class QuotaStore {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      host: config.QUOTA_DB_HOST,
      port: config.QUOTA_DB_PORT,
      user: config.QUOTA_DB_USER,
      password: config.QUOTA_DB_PASSWORD,
      database: config.QUOTA_DB_NAME,
    });
  }

  async initialize(): Promise<void> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS quota_policies (
          workspace_id           TEXT PRIMARY KEY,
          workspace_name         TEXT NOT NULL DEFAULT '',
          max_members            INTEGER,
          max_apps               INTEGER,
          max_knowledge_bases    INTEGER,
          max_monthly_tokens     BIGINT,
          max_monthly_workflow_runs INTEGER,
          warning_threshold_pct  INTEGER NOT NULL DEFAULT 80,
          updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS usage_snapshots (
          id                     BIGSERIAL PRIMARY KEY,
          workspace_id           TEXT NOT NULL,
          member_count           INTEGER NOT NULL DEFAULT 0,
          app_count              INTEGER NOT NULL DEFAULT 0,
          knowledge_base_count   INTEGER NOT NULL DEFAULT 0,
          monthly_tokens         BIGINT NOT NULL DEFAULT 0,
          monthly_workflow_runs  INTEGER NOT NULL DEFAULT 0,
          snapshot_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_usage_snapshots_ws_time
          ON usage_snapshots (workspace_id, snapshot_at DESC);
      `);
      logger.info('Quota store schema initialized');
    } finally {
      client.release();
    }
  }

  async upsertPolicy(policy: Omit<QuotaPolicy, 'updatedAt'>): Promise<void> {
    await this.pool.query(
      `INSERT INTO quota_policies
         (workspace_id, workspace_name, max_members, max_apps, max_knowledge_bases,
          max_monthly_tokens, max_monthly_workflow_runs, warning_threshold_pct, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (workspace_id) DO UPDATE SET
         workspace_name         = EXCLUDED.workspace_name,
         max_members            = EXCLUDED.max_members,
         max_apps               = EXCLUDED.max_apps,
         max_knowledge_bases    = EXCLUDED.max_knowledge_bases,
         max_monthly_tokens     = EXCLUDED.max_monthly_tokens,
         max_monthly_workflow_runs = EXCLUDED.max_monthly_workflow_runs,
         warning_threshold_pct  = EXCLUDED.warning_threshold_pct,
         updated_at             = NOW()`,
      [
        policy.workspaceId,
        policy.workspaceName,
        policy.maxMembers,
        policy.maxApps,
        policy.maxKnowledgeBases,
        policy.maxMonthlyTokens,
        policy.maxMonthlyWorkflowRuns,
        policy.warningThresholdPct ?? 80,
      ],
    );
  }

  async saveSnapshot(snapshot: UsageSnapshot): Promise<void> {
    await this.pool.query(
      `INSERT INTO usage_snapshots
         (workspace_id, member_count, app_count, knowledge_base_count,
          monthly_tokens, monthly_workflow_runs, snapshot_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        snapshot.workspaceId,
        snapshot.memberCount,
        snapshot.appCount,
        snapshot.knowledgeBaseCount,
        snapshot.monthlyTokens,
        snapshot.monthlyWorkflowRuns,
        snapshot.snapshotAt,
      ],
    );
  }

  async listPolicies(): Promise<QuotaPolicy[]> {
    const res = await this.pool.query('SELECT * FROM quota_policies ORDER BY workspace_id');
    return res.rows.map(rowToPolicy);
  }

  async getPolicy(workspaceId: string): Promise<QuotaPolicy | null> {
    const res = await this.pool.query(
      'SELECT * FROM quota_policies WHERE workspace_id = $1',
      [workspaceId],
    );
    return res.rows[0] ? rowToPolicy(res.rows[0]) : null;
  }

  async deletePolicy(workspaceId: string): Promise<void> {
    await this.pool.query('DELETE FROM quota_policies WHERE workspace_id = $1', [workspaceId]);
  }

  async getLatestSnapshot(workspaceId: string): Promise<UsageSnapshot | null> {
    const res = await this.pool.query(
      `SELECT * FROM usage_snapshots
       WHERE workspace_id = $1
       ORDER BY snapshot_at DESC LIMIT 1`,
      [workspaceId],
    );
    return res.rows[0] ? rowToSnapshot(res.rows[0]) : null;
  }

  /** Prune snapshots older than retentionDays (default 90) to prevent unbounded table growth. */
  async pruneOldSnapshots(retentionDays = 90): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const res = await this.pool.query(
      'DELETE FROM usage_snapshots WHERE snapshot_at < $1',
      [cutoff],
    );
    const deleted = res.rowCount ?? 0;
    if (deleted > 0) {
      logger.info('Pruned old usage snapshots', { deleted, retentionDays });
    }
    return deleted;
  }

  buildReport(policy: QuotaPolicy, usage: UsageSnapshot | null): QuotaReport {
    const violations: string[] = [];
    const warnings: string[] = [];

    if (usage) {
      const check = (
        label: string,
        current: number,
        max: number | null,
        threshold: number,
      ) => {
        // null = unlimited; 0 would cause divide-by-zero, treat as unlimited
        if (max === null || max <= 0) return;
        const pct = (current / max) * 100;
        if (current >= max) {
          violations.push(`${label}: ${current}/${max} (limit exceeded)`);
        } else if (pct >= threshold) {
          warnings.push(`${label}: ${current}/${max} (${pct.toFixed(0)}% of limit)`);
        }
      };

      const t = policy.warningThresholdPct;
      check('Members', usage.memberCount, policy.maxMembers, t);
      check('Apps', usage.appCount, policy.maxApps, t);
      check('Knowledge Bases', usage.knowledgeBaseCount, policy.maxKnowledgeBases, t);
      check('Monthly Tokens', usage.monthlyTokens, policy.maxMonthlyTokens, t);
      check('Monthly Workflow Runs', usage.monthlyWorkflowRuns, policy.maxMonthlyWorkflowRuns, t);
    }

    const status: QuotaStatus =
      violations.length > 0 ? 'exceeded' : warnings.length > 0 ? 'warning' : 'ok';

    return { policy, usage, status, violations, warnings };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToPolicy(row: any): QuotaPolicy {
  return {
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    maxMembers: row.max_members,
    maxApps: row.max_apps,
    maxKnowledgeBases: row.max_knowledge_bases,
    maxMonthlyTokens: row.max_monthly_tokens ? Number(row.max_monthly_tokens) : null,
    maxMonthlyWorkflowRuns: row.max_monthly_workflow_runs,
    warningThresholdPct: row.warning_threshold_pct,
    updatedAt: new Date(row.updated_at),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToSnapshot(row: any): UsageSnapshot {
  return {
    workspaceId: row.workspace_id,
    memberCount: Number(row.member_count),
    appCount: Number(row.app_count),
    knowledgeBaseCount: Number(row.knowledge_base_count),
    monthlyTokens: Number(row.monthly_tokens),
    monthlyWorkflowRuns: Number(row.monthly_workflow_runs),
    snapshotAt: new Date(row.snapshot_at),
  };
}
