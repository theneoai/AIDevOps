/**
 * Distributed WeChat access_token store backed by Redis.
 *
 * Problem solved: WeChat limits access_token refreshes to 2,000/day.
 * With multiple K8s replicas each holding in-process caches, rolling restarts
 * cause all replicas to fetch simultaneously, exhausting the daily quota.
 *
 * Solution:
 *   - Redis as shared cache: all replicas read/write the same key
 *   - Redlock (distributed mutex): only one replica fetches at a time;
 *     others wait and then read the value that winner wrote
 *   - Disk fallback: when Redis is unavailable, falls back to /tmp cache
 *     (per-process, original behaviour) so single-replica setups still work
 */

import { createClient } from 'redis';
import Redlock from 'redlock';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createLogger } from '../logger';
import { config } from '../config';

const logger = createLogger(config.LOG_LEVEL);

const REDIS_KEY = `wechat:access_token:${config.WECHAT_APP_ID}`;
const LOCK_KEY = `wechat:refresh_lock:${config.WECHAT_APP_ID}`;
const LOCK_TTL = 10_000; // 10 s — max time a single refresh should take
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before actual expiry
const DISK_CACHE_FILE = '/tmp/wechat_token_cache.json';

interface TokenData {
  token: string;
  expiresAt: number; // epoch ms
}

type RedisClient = ReturnType<typeof createClient>;

let redisClient: RedisClient | null = null;
let redlock: Redlock | null = null;
let redisAvailable = false;

export async function initTokenStore(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    logger.warn('REDIS_URL not set — WeChat token store uses per-process disk cache (not distributed)');
    return;
  }
  try {
    redisClient = createClient({ url: redisUrl });
    redisClient.on('error', (err) => {
      logger.error('Redis error in token store', { error: String(err) });
      redisAvailable = false;
    });
    redisClient.on('ready', () => { redisAvailable = true; });
    await redisClient.connect();
    redlock = new Redlock([redisClient as Parameters<typeof Redlock>[0][number]], {
      retryCount: 5,
      retryDelay: 200,
      retryJitter: 100,
    });
    redisAvailable = true;
    logger.info('WeChat token store connected to Redis');
  } catch (err) {
    logger.error('Redis connection failed — falling back to disk cache', { error: String(err) });
    redisClient = null;
    redlock = null;
    redisAvailable = false;
  }
}

// ── Redis helpers ────────────────────────────────────────────────────────────

async function readFromRedis(): Promise<TokenData | null> {
  if (!redisClient || !redisAvailable) return null;
  try {
    const raw = await redisClient.get(REDIS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TokenData;
  } catch {
    return null;
  }
}

async function writeToRedis(data: TokenData): Promise<void> {
  if (!redisClient || !redisAvailable) return;
  const ttlSeconds = Math.max(60, Math.ceil((data.expiresAt - Date.now()) / 1000));
  try {
    await redisClient.set(REDIS_KEY, JSON.stringify(data), { EX: ttlSeconds });
  } catch (err) {
    logger.warn('Failed to write token to Redis', { error: String(err) });
  }
}

// ── Disk fallback helpers ────────────────────────────────────────────────────

function readFromDisk(): TokenData | null {
  try {
    if (!existsSync(DISK_CACHE_FILE)) return null;
    return JSON.parse(readFileSync(DISK_CACHE_FILE, 'utf-8')) as TokenData;
  } catch {
    return null;
  }
}

function writeToDisk(data: TokenData): void {
  try {
    writeFileSync(DISK_CACHE_FILE, JSON.stringify(data), { mode: 0o600 });
  } catch {
    logger.warn('Failed to write token cache to disk');
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Read the cached access_token.
 * Returns null when no valid (non-expired) token is available.
 */
export async function getCachedToken(): Promise<string | null> {
  const data = redisAvailable ? await readFromRedis() : readFromDisk();
  if (!data) return null;
  if (Date.now() >= data.expiresAt - REFRESH_BUFFER_MS) return null; // needs refresh
  return data.token;
}

/**
 * Persist a freshly fetched token.
 * expiresInSeconds: value from WeChat API (typically 7200).
 */
export async function saveToken(token: string, expiresInSeconds: number): Promise<void> {
  const data: TokenData = {
    token,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  };
  await writeToRedis(data);
  writeToDisk(data); // always write disk as additional fallback
  logger.info('WeChat access_token saved', { expiresAt: new Date(data.expiresAt).toISOString() });
}

/**
 * Acquire a distributed lock before fetching a new token from WeChat.
 * Returns a release function; call it when done.
 * Falls back to a no-op lock when Redlock is unavailable.
 */
export async function acquireRefreshLock(): Promise<() => Promise<void>> {
  if (!redlock) {
    return async () => { /* no-op */ };
  }
  try {
    const lock = await redlock.acquire([LOCK_KEY], LOCK_TTL);
    return async () => {
      try { await lock.release(); } catch { /* already expired */ }
    };
  } catch (err) {
    logger.warn('Could not acquire Redlock — proceeding without lock', { error: String(err) });
    return async () => { /* no-op */ };
  }
}

export async function closeTokenStore(): Promise<void> {
  if (redisClient) await redisClient.quit();
}
