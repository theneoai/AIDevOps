import { Router, Request, Response } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { QuotaStore } from '../quota-store';
import { createLogger } from '../logger';
import { config } from '../config';

const logger = createLogger('routes/quotas');

const policySchema = z.object({
  workspaceId: z.string().min(1),
  workspaceName: z.string().default(''),
  maxMembers: z.number().int().positive().nullable().default(null),
  maxApps: z.number().int().positive().nullable().default(null),
  maxKnowledgeBases: z.number().int().positive().nullable().default(null),
  maxMonthlyTokens: z.number().int().positive().nullable().default(null),
  maxMonthlyWorkflowRuns: z.number().int().positive().nullable().default(null),
  warningThresholdPct: z.number().int().min(50).max(99).default(80),
});

function requireAdmin(req: Request, res: Response): boolean {
  // Accept both SSO headers (from nginx) and JWT Bearer tokens
  const ssoUser = req.headers['x-auth-user'] as string | undefined;
  const ssoGroups = req.headers['x-auth-groups'] as string | undefined;

  if (ssoUser) {
    const isAdmin = ssoGroups?.toLowerCase().includes('admin') ?? false;
    if (!isAdmin) {
      res.status(403).json({ error: 'platform_admin role required' });
      return false;
    }
    return true;
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return false;
  }
  try {
    const claims = jwt.verify(authHeader.slice(7), config.JWT_SECRET) as { role?: string };
    if (claims.role !== 'platform_admin') {
      res.status(403).json({ error: 'platform_admin role required' });
      return false;
    }
    return true;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return false;
  }
}

export function createQuotaRouter(store: QuotaStore): Router {
  const router = Router();

  // GET /quotas — list all quota policies with current usage + status
  router.get('/', async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    try {
      const policies = await store.listPolicies();
      const reports = await Promise.all(
        policies.map(async (p) => {
          const usage = await store.getLatestSnapshot(p.workspaceId);
          return store.buildReport(p, usage);
        }),
      );
      res.json({ data: reports });
    } catch (err) {
      logger.error('Failed to list quotas', { error: String(err) });
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // GET /quotas/:workspaceId — single workspace quota report
  router.get('/:workspaceId', async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    try {
      const policy = await store.getPolicy(req.params.workspaceId);
      if (!policy) {
        res.status(404).json({ error: 'No quota policy for this workspace' });
        return;
      }
      const usage = await store.getLatestSnapshot(req.params.workspaceId);
      res.json(store.buildReport(policy, usage));
    } catch (err) {
      logger.error('Failed to get quota', { error: String(err) });
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // POST /quotas — create or update a quota policy
  router.post('/', async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const parsed = policySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
      return;
    }
    try {
      await store.upsertPolicy(parsed.data);
      logger.info('Quota policy upserted', { workspaceId: parsed.data.workspaceId });
      res.status(201).json({ message: 'Quota policy saved', workspaceId: parsed.data.workspaceId });
    } catch (err) {
      logger.error('Failed to upsert quota', { error: String(err) });
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // DELETE /quotas/:workspaceId — remove quota policy
  router.delete('/:workspaceId', async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    try {
      await store.deletePolicy(req.params.workspaceId);
      res.status(204).send();
    } catch (err) {
      logger.error('Failed to delete quota', { error: String(err) });
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  return router;
}
