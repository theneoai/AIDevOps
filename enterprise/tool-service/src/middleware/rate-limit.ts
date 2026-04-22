import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger';

// In-memory sliding window rate limiter — no external dependency required.
// For multi-replica deployments, replace the store with a Redis-backed adapter.

interface WindowEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, WindowEntry>();

// Limits: requests per minute per key
const ROLE_LIMITS: Record<string, number> = {
  platform_admin: 3000,
  project_owner: 1000,
  developer: 500,
  viewer: 100,
  anonymous: 30,
};

const WINDOW_MS = 60_000;

function getRateLimitKey(req: Request): { key: string; limit: number } {
  const user = req.user;
  const role = user?.role ?? 'anonymous';
  const identifier = user?.sub ?? (req.ip ?? 'unknown');
  return {
    key: `${role}:${identifier}`,
    limit: ROLE_LIMITS[role] ?? ROLE_LIMITS.anonymous,
  };
}

function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.windowStart > WINDOW_MS) {
      store.delete(key);
    }
  }
}

// Clean stale entries every 5 minutes
setInterval(cleanupExpiredEntries, 5 * 60_000).unref();

export function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const { key, limit } = getRateLimitKey(req);
  const now = Date.now();

  let entry = store.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    entry = { count: 1, windowStart: now };
    store.set(key, entry);
    next();
    return;
  }

  entry.count += 1;

  const remaining = Math.max(0, limit - entry.count);
  const resetAt = Math.ceil((entry.windowStart + WINDOW_MS) / 1000);

  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', resetAt);

  if (entry.count > limit) {
    logger.warn('Rate limit exceeded', {
      key,
      count: entry.count,
      limit,
      ip: req.ip,
      path: req.path,
    });
    res.status(429).json({
      error: 'Too Many Requests',
      retry_after: resetAt - Math.floor(now / 1000),
    });
    return;
  }

  next();
}
