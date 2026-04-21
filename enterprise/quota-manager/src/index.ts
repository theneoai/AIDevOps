import express, { Request, Response } from 'express';
import cron from 'node-cron';
import { Registry, Gauge } from 'prom-client';
import { config } from './config';
import { createLogger } from './logger';
import { DifyConsoleClient } from './dify-client';
import { QuotaStore } from './quota-store';
import { createQuotaRouter } from './routes/quotas';

const logger = createLogger();
const app = express();
app.use(express.json());

// ── Prometheus metrics ─────────────────────────────────────
const registry = new Registry();
registry.setDefaultLabels({ service: 'quota-manager' });

const quotaStatusGauge = new Gauge({
  name: 'enterprise_quota_status',
  help: 'Quota status per workspace: 0=ok, 1=warning, 2=exceeded',
  labelNames: ['workspace_id', 'workspace_name'],
  registers: [registry],
});
const memberUsageGauge = new Gauge({
  name: 'enterprise_workspace_member_count',
  help: 'Number of workspace members',
  labelNames: ['workspace_id'],
  registers: [registry],
});
const appUsageGauge = new Gauge({
  name: 'enterprise_workspace_app_count',
  help: 'Number of apps in workspace',
  labelNames: ['workspace_id'],
  registers: [registry],
});
const tokenUsageGauge = new Gauge({
  name: 'enterprise_workspace_monthly_tokens',
  help: 'Monthly token consumption per workspace',
  labelNames: ['workspace_id'],
  registers: [registry],
});
const kbCountGauge = new Gauge({
  name: 'enterprise_workspace_knowledge_base_count',
  help: 'Number of knowledge bases in workspace',
  labelNames: ['workspace_id'],
  registers: [registry],
});

// ── Dependencies ───────────────────────────────────────────
const difyClient = new DifyConsoleClient(
  config.DIFY_BASE_URL,
  config.DIFY_CONSOLE_EMAIL,
  config.DIFY_CONSOLE_PASSWORD,
);
const store = new QuotaStore();

// ── Poll Dify + update metrics ─────────────────────────────
async function pollAndEnforce(): Promise<void> {
  logger.debug('Polling Dify workspace usage...');
  try {
    const usages = await difyClient.getWorkspaceUsage();
    for (const u of usages) {
      await store.saveSnapshot({
        workspaceId: u.workspaceId,
        memberCount: u.memberCount,
        appCount: u.appCount,
        knowledgeBaseCount: u.knowledgeBaseCount,
        monthlyTokens: u.monthlyTokens,
        monthlyWorkflowRuns: u.monthlyWorkflowRuns,
        snapshotAt: u.scrapedAt,
      });

      const policy = await store.getPolicy(u.workspaceId);
      if (!policy) continue;

      const report = store.buildReport(policy, {
        workspaceId: u.workspaceId,
        memberCount: u.memberCount,
        appCount: u.appCount,
        knowledgeBaseCount: u.knowledgeBaseCount,
        monthlyTokens: u.monthlyTokens,
        monthlyWorkflowRuns: u.monthlyWorkflowRuns,
        snapshotAt: u.scrapedAt,
      });

      const statusValue = report.status === 'exceeded' ? 2 : report.status === 'warning' ? 1 : 0;
      quotaStatusGauge.set({ workspace_id: u.workspaceId, workspace_name: u.workspaceName }, statusValue);
      memberUsageGauge.set({ workspace_id: u.workspaceId }, u.memberCount);
      appUsageGauge.set({ workspace_id: u.workspaceId }, u.appCount);
      tokenUsageGauge.set({ workspace_id: u.workspaceId }, u.monthlyTokens);
      kbCountGauge.set({ workspace_id: u.workspaceId }, u.knowledgeBaseCount);

      if (report.status === 'exceeded') {
        logger.warn('Quota exceeded', {
          workspaceId: u.workspaceId,
          violations: report.violations,
        });
      } else if (report.status === 'warning') {
        logger.warn('Quota warning threshold reached', {
          workspaceId: u.workspaceId,
          warnings: report.warnings,
        });
      }
    }
    logger.debug('Usage poll complete', { workspaces: usages.length });
  } catch (err) {
    logger.error('Usage poll failed', { error: String(err) });
  }
}

// ── Routes ─────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'quota-manager', version: '1.0.0' });
});

app.get('/metrics', async (_req: Request, res: Response) => {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
});

app.use('/quotas', createQuotaRouter(store));

// ── Startup ────────────────────────────────────────────────
async function start(): Promise<void> {
  await store.initialize();

  // Schedule periodic polling (cron resolution is 1 minute; sub-minute intervals round up)
  const intervalMinutes = Math.max(1, Math.ceil(config.POLL_INTERVAL_SECONDS / 60));
  const cronExpr = `*/${intervalMinutes} * * * *`;
  cron.schedule(cronExpr, () => { void pollAndEnforce(); });
  logger.info(`Scheduled usage polling every ${config.POLL_INTERVAL_SECONDS}s (cron: ${cronExpr})`);

  // Daily snapshot pruning at 03:00 to prevent unbounded table growth
  cron.schedule('0 3 * * *', () => { void store.pruneOldSnapshots(90); });

  // Run once immediately at startup
  await pollAndEnforce();

  app.listen(config.PORT, () => {
    logger.info('Quota manager started', { port: config.PORT, env: config.NODE_ENV });
  });
}

start().catch((err) => {
  logger.error('Failed to start quota manager', { error: String(err) });
  process.exit(1);
});

export default app;
