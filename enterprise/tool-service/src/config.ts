import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SERVICE_PORT: z
    .string()
    .default('3000')
    .transform((val) => parseInt(val, 10))
    .refine((val) => val >= 1 && val <= 65535, {
      message: 'SERVICE_PORT must be between 1 and 65535',
    }),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  const formatted = parsed.error.errors
    .map((e) => `${e.path.join('.')}: ${e.message}`)
    .join('\n');
  throw new Error(`Config validation failed:\n${formatted}`);
}

export const config = parsed.data;
