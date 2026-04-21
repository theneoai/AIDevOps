import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3006),

  // Dify console API (for reading usage stats)
  DIFY_BASE_URL: z.string().url(),
  DIFY_CONSOLE_EMAIL: z.string().email(),
  DIFY_CONSOLE_PASSWORD: z.string().min(1),

  // Quota store database (separate from Dify's DB)
  QUOTA_DB_HOST: z.string().default('localhost'),
  QUOTA_DB_PORT: z.coerce.number().default(5432),
  QUOTA_DB_USER: z.string().default('postgres'),
  QUOTA_DB_PASSWORD: z.string().default(''),
  QUOTA_DB_NAME: z.string().default('enterprise'),

  // How often to refresh usage metrics from Dify (seconds)
  POLL_INTERVAL_SECONDS: z.coerce.number().int().min(30).default(300),

  // JWT secret for verifying admin requests (shared with tool-service)
  JWT_SECRET: z.string().min(16),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const msgs = parsed.error.errors.map((e) => `  ${e.path.join('.')}: ${e.message}`).join('\n');
  throw new Error(`[quota-manager] Config validation failed:\n${msgs}`);
}

export const config = parsed.data;
