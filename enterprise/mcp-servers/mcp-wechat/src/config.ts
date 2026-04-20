import dotenv from 'dotenv';
import { z } from 'zod';
import { readSecret } from './secrets';

dotenv.config();

const configSchema = z.object({
  WECHAT_APP_ID: z.string().min(1, 'WECHAT_APP_ID is required'),
  MCP_SERVER_PORT: z.string()
    .default('3000')
    .transform(Number)
    .refine((val) => val >= 1 && val <= 65535, {
      message: 'MCP_SERVER_PORT must be a valid port number (1-65535)',
    }),
  MCP_SERVER_PATH: z.string().default('/sse'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Configuration error: ${JSON.stringify(parsed.error.format())}`);
}

export const config = {
  ...parsed.data,
  // Read AppSecret from Docker Secret file in production; fall back to env var for local dev
  WECHAT_APP_SECRET: readSecret('wechat_app_secret', 'WECHAT_APP_SECRET'),
};
