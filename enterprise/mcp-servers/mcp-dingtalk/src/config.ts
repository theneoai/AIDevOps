import { z } from 'zod';

const schema = z.object({
  PORT: z.string().default('3004'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DINGTALK_APP_KEY: z.string().min(1, 'DINGTALK_APP_KEY is required'),
  DINGTALK_BASE_URL: z.string().url().default('https://oapi.dingtalk.com'),
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
  dingtalkAppKey: raw.DINGTALK_APP_KEY,
  dingtalkAppSecret: readSecret('dingtalk_app_secret', 'DINGTALK_APP_SECRET'),
  dingtalkBaseUrl: raw.DINGTALK_BASE_URL,
};
