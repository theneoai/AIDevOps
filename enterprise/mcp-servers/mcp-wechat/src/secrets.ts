import { readFileSync, existsSync } from 'fs';

/**
 * Reads a secret by priority:
 * 1. Docker Secret file at /run/secrets/<name>  — production (recommended)
 * 2. Environment variable <envFallback>          — development/CI fallback
 * 3. Throws — explicit failure, no silent degradation
 */
export function readSecret(name: string, envFallback: string): string {
  const secretPath = `/run/secrets/${name}`;

  if (existsSync(secretPath)) {
    return readFileSync(secretPath, 'utf-8').trim();
  }

  const envValue = process.env[envFallback];
  if (envValue && envValue !== '') {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        `[SECURITY] Secret '${name}' loaded from env var '${envFallback}'. ` +
          'Use Docker Secrets in production.'
      );
    }
    return envValue;
  }

  throw new Error(
    `Required secret '${name}' not found. ` +
      `Provide via /run/secrets/${name} or env var ${envFallback}.`
  );
}
