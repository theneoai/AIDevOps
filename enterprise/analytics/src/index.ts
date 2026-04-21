import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import cron from 'node-cron';
import { Registry } from 'prom-client';
import { z } from 'zod';
import { DifyPoller } from './dify-poller';
import { createLogger } from './logger';

dotenv.config();

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PORT: z.coerce.number().int().default(3008),
  DIFY_BASE_URL: z.string().url(),
  DIFY_CONSOLE_EMAIL: z.string().email(),
  DIFY_CONSOLE_PASSWORD: z.string().min(1),
  ANALYTICS_POLL_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(15),
});

const parsed = configSchema.safeParse(process.env);
if (!parsed.success) {
  const msgs = parsed.error.errors.map((e) => `  ${e.path.join('.')}: ${e.message}`).join('\n');
  throw new Error(`[analytics] Config validation failed:\n${msgs}`);
}
const config = parsed.data;

const logger = createLogger();
const registry = new Registry();
registry.setDefaultLabels({ service: 'analytics' });

const poller = new DifyPoller(
  config.DIFY_BASE_URL,
  config.DIFY_CONSOLE_EMAIL,
  config.DIFY_CONSOLE_PASSWORD,
  registry,
);

const app = express();

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'analytics', version: '1.0.0' });
});

app.get('/metrics', async (_req: Request, res: Response) => {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
});

// Schedule polling
const cronExpr = `*/${config.ANALYTICS_POLL_INTERVAL_MINUTES} * * * *`;
cron.schedule(cronExpr, () => { void poller.poll(); });
logger.info(`Scheduled analytics polling every ${config.ANALYTICS_POLL_INTERVAL_MINUTES} min`);

app.listen(config.PORT, async () => {
  logger.info('Analytics service started', { port: config.PORT, env: config.NODE_ENV });
  // Initial poll on startup
  await poller.poll();
});

export default app;
