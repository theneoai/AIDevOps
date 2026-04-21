/**
 * Dify Console API client (read-only usage scraper).
 *
 * Dify's public v1 API is app-scoped; workspace-level stats live behind
 * the /console/api prefix used by the Dify web UI. We authenticate once
 * with email+password and cache the session token.
 *
 * NOTE: These endpoints are internal to Dify and subject to change across
 * versions. The quota manager degrades gracefully (logs a warning and skips
 * enforcement) when an endpoint returns 404/401.
 */
import axios, { AxiosInstance } from 'axios';
import { createLogger } from './logger';

const logger = createLogger('dify-client');

export interface WorkspaceUsage {
  workspaceId: string;
  workspaceName: string;
  memberCount: number;
  appCount: number;
  knowledgeBaseCount: number;
  /** Approximate token usage in the last 30 days (best-effort) */
  monthlyTokens: number;
  /** Workflow run count in the last 30 days */
  monthlyWorkflowRuns: number;
  scrapedAt: Date;
}

export class DifyConsoleClient {
  private client: AxiosInstance;
  private sessionToken: string | null = null;
  private email: string;
  private password: string;

  constructor(baseUrl: string, email: string, password: string) {
    this.email = email;
    this.password = password;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 15_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async ensureAuth(): Promise<void> {
    if (this.sessionToken) return;

    try {
      const res = await this.client.post('/console/api/login', {
        email: this.email,
        password: this.password,
        remember_me: true,
      });
      this.sessionToken = res.data?.data?.access_token ?? null;
      if (!this.sessionToken) throw new Error('No access_token in login response');
      this.client.defaults.headers.common['Authorization'] = `Bearer ${this.sessionToken}`;
      logger.info('Authenticated with Dify console API');
    } catch (err) {
      this.sessionToken = null;
      logger.warn('Failed to authenticate with Dify console API', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /** Invalidate cached token so next call will re-authenticate. */
  invalidateToken(): void {
    this.sessionToken = null;
    delete this.client.defaults.headers.common['Authorization'];
  }

  async getWorkspaceUsage(): Promise<WorkspaceUsage[]> {
    await this.ensureAuth();

    try {
      // Fetch workspace info
      const wsRes = await this.client.get('/console/api/workspaces/current');
      const ws = wsRes.data;

      // Fetch member count
      const membersRes = await this.client.get('/console/api/members').catch(() => ({ data: { data: [] } }));
      const memberCount: number = membersRes.data?.data?.length ?? 0;

      // Fetch app count
      const appsRes = await this.client.get('/console/api/apps', { params: { page: 1, limit: 1 } }).catch(() => ({ data: { total: 0 } }));
      const appCount: number = appsRes.data?.total ?? 0;

      // Fetch knowledge base count
      const kbRes = await this.client.get('/console/api/datasets', { params: { page: 1, limit: 1 } }).catch(() => ({ data: { total: 0 } }));
      const knowledgeBaseCount: number = kbRes.data?.total ?? 0;

      // Aggregate token usage across all apps (best effort, limited by Dify API)
      let monthlyTokens = 0;
      let monthlyWorkflowRuns = 0;
      try {
        const statsRes = await this.client.get('/console/api/apps', { params: { page: 1, limit: 100 } });
        const apps: Array<{ id: string }> = statsRes.data?.data ?? [];

        await Promise.allSettled(
          apps.slice(0, 20).map(async (app) => {
            const s = await this.client
              .get(`/console/api/apps/${app.id}/statistics/daily-conversations`, {
                params: { start: last30DaysStr(), end: todayStr() },
              })
              .catch(() => null);
            if (!s) return;
            for (const day of (s.data?.data ?? []) as Array<{ completion_tokens: number; workflow_run_count?: number }>) {
              monthlyTokens += day.completion_tokens ?? 0;
              monthlyWorkflowRuns += day.workflow_run_count ?? 0;
            }
          }),
        );
      } catch {
        // Best-effort — don't fail quota check if stats are unavailable
      }

      return [
        {
          workspaceId: ws.id,
          workspaceName: ws.name,
          memberCount,
          appCount,
          knowledgeBaseCount,
          monthlyTokens,
          monthlyWorkflowRuns,
          scrapedAt: new Date(),
        },
      ];
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 401) {
        this.invalidateToken();
      }
      logger.warn('Failed to fetch workspace usage', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function last30DaysStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}
