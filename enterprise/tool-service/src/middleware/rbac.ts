import { Request, Response, NextFunction } from 'express';
import jwt, { JwtHeader, SigningKeyCallback } from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import { tokenBlacklist } from './token-blacklist';

export type Role = 'platform_admin' | 'project_owner' | 'developer' | 'viewer';

export interface JwtClaims {
  sub: string;
  jti?: string;
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

// ── JWKS client for RS256 (OIDC-standard asymmetric tokens) ──────────────────
//
// When JWKS_URI is set, tokens are verified against the OIDC provider's public
// keys (RS256). Otherwise we fall back to the HS256 shared secret (JWT_SECRET).
// The SSO gateway is the recommended way to standardise token format.

let jwksClient: ReturnType<typeof jwksRsa> | null = null;

if (process.env.JWKS_URI) {
  jwksClient = jwksRsa({
    jwksUri: process.env.JWKS_URI,
    cache: true,
    cacheMaxEntries: 10,
    cacheMaxAge: 10 * 60 * 1000, // 10 min
    rateLimit: true,
    jwksRequestsPerMinute: 5,
  });
}

function getSigningKey(header: JwtHeader, callback: SigningKeyCallback): void {
  if (!jwksClient) {
    callback(new Error('JWKS client not configured'));
    return;
  }
  jwksClient.getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err);
      return;
    }
    callback(null, key?.getPublicKey());
  });
}

function verifyToken(token: string): Promise<JwtClaims> {
  return new Promise((resolve, reject) => {
    if (jwksClient) {
      // RS256 path — verify against OIDC provider public key
      jwt.verify(token, getSigningKey, { algorithms: ['RS256'] }, (err, decoded) => {
        if (err) return reject(err);
        resolve(decoded as JwtClaims);
      });
    } else {
      // HS256 path — verify with shared secret
      const secret = process.env.JWT_SECRET;
      if (!secret) return reject(new Error('JWT_SECRET not configured'));
      jwt.verify(token, secret, { algorithms: ['HS256'] }, (err, decoded) => {
        if (err) return reject(err);
        resolve(decoded as JwtClaims);
      });
    }
  });
}

export function requireRole(minRole: Role) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const token = authHeader.slice(7);

    let claims: JwtClaims;
    try {
      claims = await verifyToken(token);
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    // Check token blacklist (handles revocation before natural expiry)
    if (claims.jti) {
      const revoked = await tokenBlacklist.isRevoked(claims.jti);
      if (revoked) {
        res.status(401).json({ error: 'Token has been revoked' });
        return;
      }
    }

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
  };
}

/** Revoke a token by its jti claim. Call from a logout / session-invalidation endpoint. */
export async function revokeToken(claims: JwtClaims): Promise<void> {
  if (claims.jti) {
    await tokenBlacklist.revoke(claims.jti, claims.exp);
  }
}
