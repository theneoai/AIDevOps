/**
 * Tenant Context
 *
 * Carries tenant identity through the DevKit CLI command pipeline.
 * A tenant maps to a Dify workspace — each workspace has its own API key,
 * component namespace, and quota policy.
 *
 * Resolution order (highest wins):
 *   1. --tenant CLI flag
 *   2. DEVKIT_TENANT env var
 *   3. dify-dev.yaml defaultTenant field
 *   4. 'default' (single-tenant mode)
 */

export interface TenantContext {
  /** Logical tenant name (unique within the deployment) */
  tenantId: string;
  /** Dify workspace API key — may override the global config key */
  apiKey?: string;
  /** Dify base URL — may override the global config URL */
  baseUrl?: string;
}

let _current: TenantContext | null = null;

export function setTenantContext(ctx: TenantContext): void {
  _current = ctx;
}

export function getTenantContext(): TenantContext {
  if (_current) return _current;
  const envTenant = process.env.DEVKIT_TENANT;
  return { tenantId: envTenant ?? 'default' };
}

export function clearTenantContext(): void {
  _current = null;
}

/**
 * Build a TenantContext from CLI global options and config defaults.
 */
export function resolveTenant(
  cliTenant: string | undefined,
  defaultTenant: string | undefined,
  apiKey?: string,
  baseUrl?: string,
): TenantContext {
  const tenantId = cliTenant ?? process.env.DEVKIT_TENANT ?? defaultTenant ?? 'default';
  return { tenantId, apiKey, baseUrl };
}
