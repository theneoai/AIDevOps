/**
 * Configuration Management Module
 *
 * Loads and merges configuration from YAML files with environment
 * variable substitution and strong typing.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

// ─────────────────────────────────────────────────────────────
// Type-safe Config Interface
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Platform-agnostic database config (used only by the deprecated db adapter)
// ─────────────────────────────────────────────────────────────

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** @deprecated Use DatabaseConfig */
export type DifyDatabaseConfig = DatabaseConfig;

// ─────────────────────────────────────────────────────────────
// Backend (platform) config
// Keyed as `dify:` in dify-dev.yaml for backward compat, but the
// interface is platform-agnostic so backends other than Dify can be
// introduced without touching the schema.
// ─────────────────────────────────────────────────────────────

export interface BackendConfig {
  /** Backend REST API base URL (e.g. http://localhost/v1 for Dify) */
  apiUrl: string;
  /** Console/UI base URL */
  consoleUrl: string;
  /** API key for Bearer-token authenticated REST adapters */
  apiKey?: string;
  /**
   * Alias for apiUrl — some config files use baseUrl, some use apiUrl.
   * When both are set, baseUrl takes precedence.
   */
  baseUrl?: string;
  /**
   * Adapter implementation: 'api' (default) or 'db' (@deprecated, Dify-specific).
   * 'db' bypasses API validation and breaks on schema upgrades.
   */
  adapter?: 'api' | 'db';
  /** PostgreSQL connection — used by the deprecated db adapter only */
  db: DatabaseConfig;
}

/** @deprecated Use BackendConfig */
export type DifyConfig = BackendConfig;

export interface DevKitConfig {
  /**
   * Backend platform settings.
   * Config key is `dify:` in dify-dev.yaml for backward compatibility.
   */
  dify: BackendConfig;
  /** Directory containing component definitions */
  componentsDir: string;
}

// ─────────────────────────────────────────────────────────────
// Default Configuration
// ─────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: DevKitConfig = {
  dify: {
    apiUrl: 'http://localhost:5001',
    consoleUrl: 'http://localhost',
    apiKey: '${DIFY_API_KEY:-}',
    baseUrl: '${DIFY_BASE_URL:-http://localhost/v1}',
    adapter: 'api',
    db: {
      host: '${DIFY_DB_HOST:-localhost}',
      port: 5432,
      user: '${DIFY_DB_USER:-postgres}',
      password: '${DIFY_DB_PASSWORD:-difyai123456}',
      database: '${DIFY_DB_NAME:-dify}',
    },
  },
  componentsDir: './enterprise/components',
};

// ─────────────────────────────────────────────────────────────
// Environment Variable Substitution
// ─────────────────────────────────────────────────────────────

/**
 * Replaces `${VAR_NAME}` or `${VAR_NAME:-default}` patterns in a string
 * with the corresponding environment variable values.
 */
function substituteEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    // Support ${VAR:-default} syntax
    const [varName, defaultValue] = expr.split(':-');
    const envValue = process.env[varName];
    if (envValue !== undefined && envValue !== '') {
      return envValue;
    }
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    return '';
  });
}

/**
 * Recursively walks an object and substitutes environment variables
 * in all string values.
 */
function deepSubstituteEnvVars<T>(obj: T): T {
  if (typeof obj === 'string') {
    return substituteEnvVars(obj) as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(deepSubstituteEnvVars) as unknown as T;
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deepSubstituteEnvVars(value);
    }
    return result as unknown as T;
  }
  return obj;
}

// ─────────────────────────────────────────────────────────────
// Deep Merge
// ─────────────────────────────────────────────────────────────

function isPlainObject(item: unknown): item is Record<string, unknown> {
  return item !== null && typeof item === 'object' && !Array.isArray(item);
}

function deepMerge(target: unknown, source: unknown): unknown {
  if (!isPlainObject(source)) {
    return target;
  }
  if (!isPlainObject(target)) {
    return source;
  }
  const output: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(target), ...Object.keys(source)])) {
    const sourceValue = source[key];
    const targetValue = target[key];
    if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
      output[key] = deepMerge(targetValue, sourceValue);
    } else if (sourceValue !== undefined) {
      output[key] = sourceValue;
    } else {
      output[key] = targetValue;
    }
  }
  return output;
}

// ─────────────────────────────────────────────────────────────
// Config Loader
// ─────────────────────────────────────────────────────────────

const CONFIG_FILE_NAMES = ['dify-dev.yaml', '.dify-dev.yaml'];

function findConfigFile(startDir: string = process.cwd()): string | null {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (true) {
    for (const fileName of CONFIG_FILE_NAMES) {
      const filePath = path.join(currentDir, fileName);
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }
    if (currentDir === root) {
      break;
    }
    currentDir = path.dirname(currentDir);
  }
  return null;
}

function loadYamlFile(filePath: string): unknown {
  const content = fs.readFileSync(filePath, 'utf-8');
  return yaml.parse(content);
}

/**
 * Loads the DevKit configuration.
 *
 * 1. Starts with hard-coded defaults.
 * 2. Searches upward from `startDir` (or cwd) for `dify-dev.yaml` or `.dify-dev.yaml`.
 * 3. Merges file contents over defaults (deep merge).
 * 4. Substitutes `${VAR}` and `${VAR:-default}` patterns from environment variables.
 *
 * @param startDir - Directory to start searching for config files (default: process.cwd())
 * @returns Fully resolved, type-safe configuration object
 */
export function loadConfig(startDir?: string): DevKitConfig {
  let config: DevKitConfig = { ...DEFAULT_CONFIG };

  const configPath = findConfigFile(startDir);
  if (configPath) {
    const fileConfig = loadYamlFile(configPath);
    config = deepSubstituteEnvVars(deepMerge(config, fileConfig)) as DevKitConfig;
  } else {
    config = deepSubstituteEnvVars(config);
  }

  return config;
}

/**
 * Returns the path of the loaded config file, or `null` if none was found.
 */
export function getConfigPath(startDir?: string): string | null {
  return findConfigFile(startDir);
}
