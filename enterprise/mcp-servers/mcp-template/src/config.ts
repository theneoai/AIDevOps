import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  MCP_SERVER_PORT: z
    .string()
    .default('3000')
    .transform((val) => parseInt(val, 10))
    .refine((val) => val >= 1 && val <= 65535, {
      message: 'MCP_SERVER_PORT must be a number between 1 and 65535',
    }),
  MCP_SERVER_PATH: z.string().default('/sse'),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  const formattedErrors = parsed.error.errors
    .map((err) => `  - ${err.path.join('.')}: ${err.message}`)
    .join('\n');
  throw new Error(`Configuration validation failed:\n${formattedErrors}`);
}

export const config = parsed.data;
