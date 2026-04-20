import { z } from 'zod';

const schema = z.object({
  PORT: z.string().default('3003'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  FEISHU_APP_ID: z.string().min(1, 'FEISHU_APP_ID is required'),
  FEISHU_BASE_URL: z.string().url().default('https://open.feishu.cn'),
});

function readSecret(name: string, envFallback: string): string {
  const { existsSync, readFileSync } = require('fs');
  const secretPath = `/run/secrets/${name}`;
  if (existsSync(secretPath)) return readFileSync(secretPath, 'utf-8').trim();
  const val = process.env[envFallback];
  if (val) return val;
  throw new Error(`Required secret '${name}' not found in /run/secrets or env '${envFallback}'`);
}

const raw = schema.parse(process.env);

export const config = {
  port: parseInt(raw.PORT, 10),
  logLevel: raw.LOG_LEVEL,
  feishuAppId: raw.FEISHU_APP_ID,
  feishuAppSecret: readSecret('feishu_app_secret', 'FEISHU_APP_SECRET'),
  feishuBaseUrl: raw.FEISHU_BASE_URL,
};
