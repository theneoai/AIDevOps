import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { IMConfig } from './backends/types';

const envSchema = z.object({
  PORT: z.string().default('3005'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /** Path to im-config.json — can be absolute or relative to CWD */
  IM_CONFIG_PATH: z.string().default('./im-config.json'),
  /** Fallback: single webhook URL (skips im-config.json if IM_CONFIG_PATH not found) */
  IM_WEBHOOK_URL: z.string().optional(),
  /** Auth token for the fallback webhook */
  IM_WEBHOOK_TOKEN: z.string().optional(),
  /** Auth type for the fallback webhook: none | bearer | api_key | hmac_sha256 */
  IM_WEBHOOK_AUTH: z.enum(['none', 'bearer', 'api_key', 'hmac_sha256']).default('none'),
});

const raw = envSchema.parse(process.env);

function loadIMConfig(): IMConfig {
  const configPath = path.resolve(process.cwd(), raw.IM_CONFIG_PATH);

  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as IMConfig;
  }

  // Fallback to single-webhook mode from env vars
  if (raw.IM_WEBHOOK_URL) {
    console.warn(
      `[mcp-custom-im] No im-config.json found at ${configPath}, falling back to IM_WEBHOOK_URL`,
    );
    return {
      backends: [
        {
          name: 'default',
          type: 'webhook',
          url: raw.IM_WEBHOOK_URL,
          auth: {
            type: raw.IM_WEBHOOK_AUTH,
            token: raw.IM_WEBHOOK_TOKEN,
          },
        },
      ],
      defaultBackend: 'default',
    };
  }

  throw new Error(
    `No IM backend configured. Provide IM_CONFIG_PATH or IM_WEBHOOK_URL environment variable.`,
  );
}

export const config = {
  port: parseInt(raw.PORT, 10),
  logLevel: raw.LOG_LEVEL,
  imConfig: loadIMConfig(),
};
