/**
 * Pre-flight quota check endpoint.
 *
 * Agents and tool-service call this BEFORE executing a workflow/LLM call to
 * determine whether the workspace has budget remaining. This converts Quota
 * Manager from a post-hoc accounting tool into a real enforcement gate.
 *
 * POST /quotas/preflight
 * Body: { workspaceId: string; estimatedTokens?: number; estimatedWorkflowRuns?: number }
 *
 * Response 200: { allowed: true }
 * Response 429: { allowed: false; reason: string; violations: string[] }
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { QuotaStore } from '../quota-store';
import { createLogger } from '../logger';

const logger = createLogger('preflight');

const preflightSchema = z.object({
  workspaceId: z.string().min(1),
  estimatedTokens: z.number().int().nonnegative().optional(),
  estimatedWorkflowRuns: z.number().int().nonnegative().optional(),
});

export function createPreflightRouter(store: QuotaStore): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    const parsed = preflightSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
      return;
    }

    const { workspaceId, estimatedTokens = 0, estimatedWorkflowRuns = 0 } = parsed.data;

    try {
      const [policy, usage] = await Promise.all([
        store.getPolicy(workspaceId),
        store.getLatestSnapshot(workspaceId),
      ]);

      // No policy configured → allow by default (open workspace)
      if (!policy) {
        res.json({ allowed: true, reason: 'no_policy' });
        return;
      }

      const violations: string[] = [];

      const checkLimit = (
        label: string,
        current: number,
        estimated: number,
        max: number | null,
      ) => {
        if (max === null || max <= 0) return;
        const projected = current + estimated;
        if (projected > max) {
          violations.push(`${label}: projected ${projected} would exceed limit ${max}`);
        } else if (current >= max) {
          violations.push(`${label}: current ${current} already at limit ${max}`);
        }
      };

      const currentTokens = usage?.monthlyTokens ?? 0;
      const currentRuns = usage?.monthlyWorkflowRuns ?? 0;

      checkLimit('Monthly Tokens', currentTokens, estimatedTokens, policy.maxMonthlyTokens);
      checkLimit('Monthly Workflow Runs', currentRuns, estimatedWorkflowRuns, policy.maxMonthlyWorkflowRuns);

      if (violations.length > 0) {
        logger.warn('Pre-flight quota check rejected', { workspaceId, violations });
        res.status(429).json({
          allowed: false,
          reason: 'quota_exceeded',
          violations,
        });
        return;
      }

      res.json({ allowed: true });
    } catch (err) {
      // Fail open: if quota store is unavailable, allow the request
      // to prevent quota-manager outage from blocking all AI operations.
      logger.error('Pre-flight check error — failing open', { error: String(err) });
      res.json({ allowed: true, reason: 'quota_service_unavailable' });
    }
  });

  return router;
}
