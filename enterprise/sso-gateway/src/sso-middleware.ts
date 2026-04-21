/**
 * SSO Middleware for Enterprise Services
 *
 * When nginx sits in front of all enterprise services with SSO enforced,
 * downstream services receive X-Auth-User and X-Auth-Email headers injected
 * by oauth2-proxy. This middleware parses those headers and populates
 * req.ssoUser so route handlers can make authorization decisions.
 *
 * In standalone/dev mode (SSO_ENABLED=false), identity is read from a JWT
 * Bearer token instead, falling back to the existing RBAC middleware.
 */
import { Request, Response, NextFunction } from 'express';

export interface SSOUser {
  id: string;
  email: string;
  groups: string[];
  /** Mapped RBAC role derived from IdP group membership */
  role: 'platform_admin' | 'project_owner' | 'developer' | 'viewer';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ssoUser?: SSOUser;
    }
  }
}

/** Maps IdP group names to internal RBAC roles (highest match wins). */
const GROUP_ROLE_MAP: Array<{ pattern: RegExp; role: SSOUser['role'] }> = [
  { pattern: /platform.?admin|super.?admin/i, role: 'platform_admin' },
  { pattern: /project.?owner|workspace.?owner/i, role: 'project_owner' },
  { pattern: /developer|dev.?team/i, role: 'developer' },
  { pattern: /viewer|read.?only/i, role: 'viewer' },
];

function mapGroupsToRole(groups: string[]): SSOUser['role'] {
  const priorities: Record<SSOUser['role'], number> = {
    platform_admin: 40,
    project_owner: 30,
    developer: 20,
    viewer: 10,
  };

  let best: SSOUser['role'] = 'viewer';
  for (const group of groups) {
    for (const mapping of GROUP_ROLE_MAP) {
      if (mapping.pattern.test(group)) {
        if (priorities[mapping.role] > priorities[best]) {
          best = mapping.role;
        }
      }
    }
  }
  return best;
}

/**
 * Parses SSO identity headers injected by oauth2-proxy (set_xauthrequest=true).
 * Attaches the resolved user to req.ssoUser.
 * If headers are absent (e.g. direct call bypassing nginx), returns 401.
 */
export function ssoMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (process.env.SSO_ENABLED === 'false') {
    // SSO disabled — let the existing JWT RBAC middleware handle auth.
    next();
    return;
  }

  const rawUser = req.headers['x-auth-user'] as string | undefined;
  const rawEmail = req.headers['x-auth-email'] as string | undefined;

  if (!rawUser || !rawEmail) {
    res.status(401).json({
      error: 'Unauthenticated',
      detail: 'Missing X-Auth-User/X-Auth-Email headers. Ensure nginx SSO is active.',
    });
    return;
  }

  const rawGroups = req.headers['x-auth-groups'] as string | undefined;
  const groups = rawGroups ? rawGroups.split(',').map((g) => g.trim()) : [];

  req.ssoUser = {
    id: rawUser,
    email: rawEmail,
    groups,
    role: mapGroupsToRole(groups),
  };

  next();
}

/**
 * Requires the resolved SSO user to have at least the given role.
 * Must be used after ssoMiddleware().
 */
export function requireSSORole(minRole: SSOUser['role']) {
  const PRIORITY: Record<SSOUser['role'], number> = {
    platform_admin: 40,
    project_owner: 30,
    developer: 20,
    viewer: 10,
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.ssoUser;
    if (!user) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }
    if (PRIORITY[user.role] < PRIORITY[minRole]) {
      res.status(403).json({
        error: 'Insufficient permissions',
        required: minRole,
        actual: user.role,
      });
      return;
    }
    next();
  };
}
