/**
 * Dify Analytics Poller
 *
 * Periodically scrapes Dify's console API for per-app usage statistics
 * and exposes them as Prometheus metrics. Grafana dashboards then visualise
 * cross-workspace trends without requiring any modification to Dify.
 *
 * Metrics emitted:
 *   dify_daily_conversations_total    — conversation count per app per day
 *   dify_daily_active_users_total     — unique users per app per day
 *   dify_daily_tokens_used_total      — tokens consumed per app per day
 *   dify_app_count                    — total number of apps in workspace
 *   dify_member_count                 — total workspace members
 *   dify_knowledge_base_count         — total knowledge bases
 *   dify_workflow_run_total           — workflow execution count
 */
import axios, { AxiosInstance } from 'axios';
import { Gauge, Counter, Registry } from 'prom-client';
import { createLogger } from './logger';

const logger = createLogger('dify-poller');

interface AppStat {
  date: string;
  conversation_count: number;
  active_users: number;
  completion_tokens: number;
  prompt_tokens: number;
  workflow_run_count: number;
}

interface App {
  id: string;
  name: string;
  mode: string; // 'chat' | 'workflow' | 'agent-chat' | 'advanced-chat' | 'completion'
}

export class DifyPoller {
  private client: AxiosInstance;
  private sessionToken: string | null = null;
  private email: string;
  private password: string;

  // Prometheus metrics
  private conversationsGauge: Gauge;
  private activeUsersGauge: Gauge;
  private tokensGauge: Gauge;
  private workflowRunsGauge: Gauge;
  private appCountGauge: Gauge;
  private memberCountGauge: Gauge;
  private kbCountGauge: Gauge;
  private pollSuccessCounter: Counter;
  private pollErrorCounter: Counter;

  constructor(baseUrl: string, email: string, password: string, registry: Registry) {
    this.email = email;
    this.password = password;
    this.client = axios.create({ baseURL: baseUrl, timeout: 30_000 });

    this.conversationsGauge = new Gauge({
      name: 'dify_daily_conversations_total',
      help: 'Daily conversation count per app (last 30 days sum)',
      labelNames: ['app_id', 'app_name', 'mode'],
      registers: [registry],
    });
    this.activeUsersGauge = new Gauge({
      name: 'dify_daily_active_users_total',
      help: 'Unique active users per app (last 30 days sum)',
      labelNames: ['app_id', 'app_name', 'mode'],
      registers: [registry],
    });
    this.tokensGauge = new Gauge({
      name: 'dify_daily_tokens_used_total',
      help: 'Tokens consumed per app (last 30 days sum)',
      labelNames: ['app_id', 'app_name', 'mode'],
      registers: [registry],
    });
    this.workflowRunsGauge = new Gauge({
      name: 'dify_workflow_run_total',
      help: 'Workflow execution count per app (last 30 days sum)',
      labelNames: ['app_id', 'app_name'],
      registers: [registry],
    });
    this.appCountGauge = new Gauge({
      name: 'dify_app_count',
      help: 'Total number of apps in the Dify workspace',
      registers: [registry],
    });
    this.memberCountGauge = new Gauge({
      name: 'dify_member_count',
      help: 'Total workspace members',
      registers: [registry],
    });
    this.kbCountGauge = new Gauge({
      name: 'dify_knowledge_base_count',
      help: 'Total knowledge bases',
      registers: [registry],
    });
    this.pollSuccessCounter = new Counter({
      name: 'dify_analytics_poll_success_total',
      help: 'Successful Dify analytics poll runs',
      registers: [registry],
    });
    this.pollErrorCounter = new Counter({
      name: 'dify_analytics_poll_error_total',
      help: 'Failed Dify analytics poll runs',
      registers: [registry],
    });
  }

  private async ensureAuth(): Promise<void> {
    if (this.sessionToken) return;
    const res = await this.client.post('/console/api/login', {
      email: this.email,
      password: this.password,
      remember_me: true,
    });
    this.sessionToken = res.data?.data?.access_token;
    if (!this.sessionToken) throw new Error('No access_token in Dify login response');
    this.client.defaults.headers.common['Authorization'] = `Bearer ${this.sessionToken}`;
  }

  async poll(): Promise<void> {
    try {
      await this.ensureAuth();
      await Promise.all([this.pollApps(), this.pollWorkspaceMeta()]);
      this.pollSuccessCounter.inc();
      logger.info('Analytics poll complete');
    } catch (err) {
      this.pollErrorCounter.inc();
      if ((err as { response?: { status?: number } }).response?.status === 401) {
        this.sessionToken = null;
        delete this.client.defaults.headers.common['Authorization'];
      }
      logger.warn('Analytics poll failed', { error: String(err) });
    }
  }

  private async pollApps(): Promise<void> {
    const appsRes = await this.client.get('/console/api/apps', {
      params: { page: 1, limit: 100 },
    }).catch(() => null);
    if (!appsRes) return;

    const apps: App[] = appsRes.data?.data ?? [];
    this.appCountGauge.set(appsRes.data?.total ?? apps.length);

    const start = this.daysAgo(30);
    const end = this.today();

    await Promise.allSettled(
      apps.map(async (app) => {
        const statsRes = await this.client.get(
          `/console/api/apps/${app.id}/statistics/daily-conversations`,
          { params: { start, end } },
        ).catch(() => null);
        if (!statsRes) return;

        const stats: AppStat[] = statsRes.data?.data ?? [];
        const sumConv = stats.reduce((s, d) => s + (d.conversation_count ?? 0), 0);
        const sumUsers = stats.reduce((s, d) => s + (d.active_users ?? 0), 0);
        const sumTokens = stats.reduce((s, d) => s + (d.completion_tokens ?? 0) + (d.prompt_tokens ?? 0), 0);
        const sumRuns = stats.reduce((s, d) => s + (d.workflow_run_count ?? 0), 0);

        const labels = { app_id: app.id, app_name: app.name, mode: app.mode };
        this.conversationsGauge.set(labels, sumConv);
        this.activeUsersGauge.set(labels, sumUsers);
        this.tokensGauge.set(labels, sumTokens);
        this.workflowRunsGauge.set({ app_id: app.id, app_name: app.name }, sumRuns);
      }),
    );
  }

  private async pollWorkspaceMeta(): Promise<void> {
    const [membersRes, kbRes] = await Promise.allSettled([
      this.client.get('/console/api/members'),
      this.client.get('/console/api/datasets', { params: { page: 1, limit: 1 } }),
    ]);

    if (membersRes.status === 'fulfilled') {
      this.memberCountGauge.set(membersRes.value.data?.data?.length ?? 0);
    }
    if (kbRes.status === 'fulfilled') {
      this.kbCountGauge.set(kbRes.value.data?.total ?? 0);
    }
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private daysAgo(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }
}
