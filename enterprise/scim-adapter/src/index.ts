/**
 * SCIM 2.0 Adapter — Entry point
 *
 * Exposes SCIM 2.0 endpoints at /scim/v2/ so any OIDC/SAML IdP that
 * supports SCIM provisioning (Okta, Azure AD, Keycloak, Authentik)
 * can automatically provision and deprovision Dify workspace members.
 *
 * Authentication: Bearer token (SCIM_BEARER_TOKEN env var) — IdPs send
 * this as Authorization: Bearer <token> in every SCIM request.
 * This is separate from user SSO; it's a long-lived service-to-service token.
 */
import dotenv from 'dotenv';
import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { DifyMemberClient } from './dify-client';
import { createUsersRouter } from './handlers/users';
import { createGroupsRouter } from './handlers/groups';
import { createLogger } from './logger';
import {
  SCIM_SCHEMA_ERROR,
  SCIM_SCHEMA_USER,
  SCIM_SCHEMA_GROUP,
  STATIC_GROUPS,
} from './scim-types';

dotenv.config();

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PORT: z.coerce.number().int().default(3007),
  DIFY_BASE_URL: z.string().url(),
  DIFY_CONSOLE_EMAIL: z.string().email(),
  DIFY_CONSOLE_PASSWORD: z.string().min(1),
  SCIM_BEARER_TOKEN: z.string().min(16),
  SCIM_BASE_URL: z.string().default('http://localhost:3007'),
});

const parsed = configSchema.safeParse(process.env);
if (!parsed.success) {
  const msgs = parsed.error.errors.map((e) => `  ${e.path.join('.')}: ${e.message}`).join('\n');
  throw new Error(`[scim-adapter] Config validation failed:\n${msgs}`);
}
const config = parsed.data;

const logger = createLogger();
const app = express();
app.use(express.json({ type: ['application/json', 'application/scim+json'] }));

// ── Bearer token authentication ────────────────────────────
function requireBearer(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers['authorization'];
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ schemas: [SCIM_SCHEMA_ERROR], status: 401, detail: 'Missing Bearer token' });
    return;
  }
  if (auth.slice(7) !== config.SCIM_BEARER_TOKEN) {
    res.status(403).json({ schemas: [SCIM_SCHEMA_ERROR], status: 403, detail: 'Invalid Bearer token' });
    return;
  }
  next();
}

// ── SCIM content type ──────────────────────────────────────
app.use('/scim', requireBearer);
app.use('/scim', (_req, res, next) => {
  res.setHeader('Content-Type', 'application/scim+json');
  next();
});

// ── Dify client + routers ──────────────────────────────────
const difyClient = new DifyMemberClient(
  config.DIFY_BASE_URL,
  config.DIFY_CONSOLE_EMAIL,
  config.DIFY_CONSOLE_PASSWORD,
);

app.use('/scim/v2/Users', createUsersRouter(difyClient, config.SCIM_BASE_URL));
app.use('/scim/v2/Groups', createGroupsRouter(difyClient, config.SCIM_BASE_URL));

// ── ServiceProviderConfig (required by SCIM spec) ──────────
app.get('/scim/v2/ServiceProviderConfig', (_req: Request, res: Response) => {
  res.json({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri: 'https://datatracker.ietf.org/doc/html/rfc7644',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        name: 'OAuth Bearer Token',
        description: 'Authentication scheme using OAuth 2.0 Bearer Token',
        specUri: 'http://www.rfc-editor.org/info/rfc6750',
        type: 'oauthbearertoken',
        primary: true,
      },
    ],
    meta: { resourceType: 'ServiceProviderConfig', location: `${config.SCIM_BASE_URL}/scim/v2/ServiceProviderConfig` },
  });
});

// ── Schemas endpoint ───────────────────────────────────────
app.get('/scim/v2/Schemas', (_req: Request, res: Response) => {
  res.json({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: 2,
    Resources: [
      { id: SCIM_SCHEMA_USER, name: 'User', description: 'Dify workspace member' },
      { id: SCIM_SCHEMA_GROUP, name: 'Group', description: 'Dify workspace role group' },
    ],
  });
});

// ── ResourceTypes endpoint ─────────────────────────────────
app.get('/scim/v2/ResourceTypes', (_req: Request, res: Response) => {
  res.json({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: 2,
    Resources: [
      { id: 'User', name: 'User', endpoint: '/scim/v2/Users', schema: SCIM_SCHEMA_USER },
      { id: 'Group', name: 'Group', endpoint: '/scim/v2/Groups', schema: SCIM_SCHEMA_GROUP },
    ],
  });
});

// ── Health ─────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'scim-adapter', version: '1.0.0' });
});

void STATIC_GROUPS; // referenced in group handlers

app.listen(config.PORT, () => {
  logger.info('SCIM adapter started', { port: config.PORT, env: config.NODE_ENV });
});

export default app;
