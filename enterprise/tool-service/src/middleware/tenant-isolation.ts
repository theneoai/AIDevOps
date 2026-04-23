/**
 * Tenant Isolation Middleware
 *
 * Enforces that authenticated users can only access resources within their
 * own tenant. Reads tenant_id from the JWT claims set by requireRole() and
 * compares it against the tenant_id in the request body or query parameter.
 *
 * Must be mounted AFTER requireRole() so req.user is already populated.
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger';

export function tenantIsolation(req: Request, res: Response, next: NextFunction): void {
  const user = req.user;
  if (!user) {
    // No user means no auth — let requireRole() handle this case
    next();
    return;
  }

  // platform_admin can cross tenant boundaries (e.g. for quota management)
  if (user.role === 'platform_admin') {
    next();
    return;
  }

  // Extract tenant_id from various request locations
  const requestedTenant =
    (req.body as Record<string, unknown>)?.tenant_id as string | undefined ||
    (req.query.tenant_id as string | undefined) ||
    (req.params.tenant_id as string | undefined);

  if (requestedTenant && requestedTenant !== user.tenant_id) {
    logger.warn('Tenant isolation violation', {
      userId: user.sub,
      userTenant: user.tenant_id,
      requestedTenant,
      path: req.path,
    });
    res.status(403).json({
      error: 'Cross-tenant access denied',
      your_tenant: user.tenant_id,
    });
    return;
  }

  next();
}
