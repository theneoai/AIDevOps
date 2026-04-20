import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export type Role = 'platform_admin' | 'project_owner' | 'developer' | 'viewer';

export interface JwtClaims {
  sub: string;
  email: string;
  role: Role;
  tenant_id: string;
  project_ids: string[];
  iat: number;
  exp: number;
}

const ROLE_HIERARCHY: Record<Role, number> = {
  platform_admin: 40,
  project_owner: 30,
  developer: 20,
  viewer: 10,
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtClaims;
    }
  }
}

export function requireRole(minRole: Role) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const token = authHeader.slice(7);
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      res.status(500).json({ error: 'JWT_SECRET not configured' });
      return;
    }

    try {
      const claims = jwt.verify(token, secret) as JwtClaims;
      const userLevel = ROLE_HIERARCHY[claims.role] ?? 0;
      const requiredLevel = ROLE_HIERARCHY[minRole];

      if (userLevel < requiredLevel) {
        res.status(403).json({
          error: 'Insufficient permissions',
          required: minRole,
          actual: claims.role,
        });
        return;
      }

      req.user = claims;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}
