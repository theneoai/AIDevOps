/**
 * Token Blacklist — in-memory implementation with optional Redis backend.
 *
 * When REDIS_URL is set the blacklist is shared across all replicas.
 * Without Redis, revocation is process-local only (acceptable for single-replica deploys).
 *
 * TTL for each entry equals the token's remaining lifetime so the store
 * never grows unboundedly.
 */

import { createClient, RedisClientType } from 'redis';
import { logger } from '../logger';

type RedisClient = ReturnType<typeof createClient>;

class TokenBlacklist {
  private redis: RedisClient | null = null;
  private local = new Map<string, number>(); // jti → expiresAt (epoch ms)
  private ready = false;

  async init(): Promise<void> {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      this.ready = true;
      logger.warn('REDIS_URL not set — token blacklist is process-local only (not shared across replicas)');
      return;
    }

    try {
      this.redis = createClient({ url: redisUrl });
      this.redis.on('error', (err) => logger.error('Redis client error', { error: String(err) }));
      await this.redis.connect();
      this.ready = true;
      logger.info('Token blacklist connected to Redis', { url: redisUrl.replace(/:\/\/.*@/, '://***@') });
    } catch (err) {
      logger.error('Failed to connect Redis — falling back to in-memory blacklist', { error: String(err) });
      this.redis = null;
      this.ready = true;
    }
  }

  async revoke(jti: string, expiresAt: number): Promise<void> {
    const ttlSeconds = Math.max(1, Math.ceil((expiresAt * 1000 - Date.now()) / 1000));

    if (this.redis) {
      await this.redis.set(`blacklist:${jti}`, '1', { EX: ttlSeconds });
    } else {
      this.local.set(jti, expiresAt * 1000);
      this.scheduleLocalCleanup();
    }
  }

  async isRevoked(jti: string): Promise<boolean> {
    if (this.redis) {
      const val = await this.redis.get(`blacklist:${jti}`);
      return val !== null;
    }
    const exp = this.local.get(jti);
    if (exp === undefined) return false;
    if (Date.now() > exp) {
      this.local.delete(jti);
      return false;
    }
    return true;
  }

  private cleanupTimer: NodeJS.Timeout | null = null;

  private scheduleLocalCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setTimeout(() => {
      const now = Date.now();
      for (const [jti, exp] of this.local.entries()) {
        if (now > exp) this.local.delete(jti);
      }
      this.cleanupTimer = null;
    }, 60_000).unref();
  }

  async close(): Promise<void> {
    if (this.redis) await this.redis.quit();
  }
}

export const tokenBlacklist = new TokenBlacklist();
