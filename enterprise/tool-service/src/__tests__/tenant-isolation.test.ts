/**
 * Tenant Isolation Middleware Tests
 */

import { Request, Response, NextFunction } from 'express';
import { tenantIsolation } from '../middleware/tenant-isolation';
import { JwtClaims } from '../middleware/rbac';

function makeUser(role: JwtClaims['role'], tenantId: string): JwtClaims {
  return { sub: 'u1', email: 'u@t.com', role, tenant_id: tenantId, project_ids: [], iat: 0, exp: 9999999999 };
}

function makeReq(user: JwtClaims | undefined, bodyTenantId?: string, queryTenantId?: string): Partial<Request> {
  return {
    user,
    body: bodyTenantId ? { tenant_id: bodyTenantId } : {},
    query: queryTenantId ? { tenant_id: queryTenantId } : {},
    params: {},
    path: '/tools/summarize',
  };
}

function makeRes(): { status: jest.Mock; json: jest.Mock } {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe('tenantIsolation middleware', () => {
  it('allows request when no tenant_id in body (no cross-tenant concern)', () => {
    const req = makeReq(makeUser('developer', 'tenant-a'));
    const res = makeRes();
    const next = jest.fn();
    tenantIsolation(req as Request, res as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows request when tenant_id matches user tenant', () => {
    const req = makeReq(makeUser('developer', 'tenant-a'), 'tenant-a');
    const res = makeRes();
    const next = jest.fn();
    tenantIsolation(req as Request, res as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalled();
  });

  it('blocks cross-tenant access for non-admin', () => {
    const req = makeReq(makeUser('developer', 'tenant-a'), 'tenant-b');
    const res = makeRes();
    const next = jest.fn();
    tenantIsolation(req as Request, res as unknown as Response, next as NextFunction);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows platform_admin to cross tenant boundaries', () => {
    const req = makeReq(makeUser('platform_admin', 'tenant-a'), 'tenant-b');
    const res = makeRes();
    const next = jest.fn();
    tenantIsolation(req as Request, res as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('passes through when no user is set', () => {
    const req = makeReq(undefined, 'tenant-x');
    const res = makeRes();
    const next = jest.fn();
    tenantIsolation(req as Request, res as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalled();
  });
});
