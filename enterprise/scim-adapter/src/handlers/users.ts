/**
 * SCIM 2.0 Users resource handlers
 *
 * Maps SCIM operations to Dify member management:
 *   POST /Users      → dify.inviteMember(email, role)
 *   GET  /Users      → dify.listMembers()
 *   GET  /Users/:id  → dify.getMember(id)
 *   PUT  /Users/:id  → dify.updateMemberRole(id, role) + active=false → removeMember
 *   PATCH /Users/:id → handle active=false (deprovision) or role change
 *   DELETE /Users/:id→ dify.removeMember(id)
 */
import { Router, Request, Response } from 'express';
import { DifyMemberClient, DifyMember } from '../dify-client';
import {
  ScimUser,
  ScimListResponse,
  SCIM_SCHEMA_USER,
  SCIM_SCHEMA_LIST,
  scimError,
  ScimPatchOp,
  DIFY_ROLE_TO_GROUP,
  GROUP_TO_DIFY_ROLE,
} from '../scim-types';
import { createLogger } from '../logger';

const logger = createLogger('handlers/users');

function toScimUser(m: DifyMember, baseUrl: string): ScimUser {
  return {
    schemas: [SCIM_SCHEMA_USER],
    id: m.id,
    userName: m.email,
    displayName: m.name || m.email,
    name: { formatted: m.name || m.email },
    emails: [{ value: m.email, type: 'work', primary: true }],
    active: m.status === 'active' || m.status === 'pending',
    meta: {
      resourceType: 'User',
      created: m.createdAt,
      lastModified: m.lastActiveAt ?? m.createdAt,
      location: `${baseUrl}/scim/v2/Users/${m.id}`,
    },
  };
}

export function createUsersRouter(client: DifyMemberClient, baseUrl: string): Router {
  const router = Router();

  // GET /scim/v2/Users[?filter=userName eq "email"]
  router.get('/', async (req: Request, res: Response) => {
    try {
      const filter = req.query['filter'] as string | undefined;
      const startIndex = parseInt(String(req.query['startIndex'] ?? '1'), 10);
      const count = parseInt(String(req.query['count'] ?? '100'), 10);

      let members = await client.listMembers();

      // SCIM filter: userName eq "email@domain.com" (Okta/Azure AD uses this for lookup)
      if (filter) {
        const match = /userName\s+eq\s+"([^"]+)"/i.exec(filter);
        if (match) {
          const email = match[1].toLowerCase();
          members = members.filter((m) => m.email.toLowerCase() === email);
        }
      }

      const total = members.length;
      const page = members.slice(startIndex - 1, startIndex - 1 + count);

      const response: ScimListResponse<ScimUser> = {
        schemas: [SCIM_SCHEMA_LIST],
        totalResults: total,
        startIndex,
        itemsPerPage: page.length,
        Resources: page.map((m) => toScimUser(m, baseUrl)),
      };
      res.json(response);
    } catch (err) {
      logger.error('GET /Users failed', { error: String(err) });
      res.status(500).json(scimError(500, 'Failed to list users'));
    }
  });

  // GET /scim/v2/Users/:id
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const member = await client.getMember(req.params.id);
      if (!member) {
        res.status(404).json(scimError(404, `User ${req.params.id} not found`));
        return;
      }
      res.json(toScimUser(member, baseUrl));
    } catch (err) {
      logger.error('GET /Users/:id failed', { id: req.params.id, error: String(err) });
      res.status(500).json(scimError(500, 'Failed to fetch user'));
    }
  });

  // POST /scim/v2/Users — provision new user (invite)
  router.post('/', async (req: Request, res: Response) => {
    try {
      const body = req.body as Partial<ScimUser>;
      const email = (body.emails?.[0]?.value ?? body.userName ?? '').toLowerCase();
      if (!email) {
        res.status(400).json(scimError(400, 'userName or emails[0].value required', 'invalidValue'));
        return;
      }

      // Check if already a member (idempotent)
      const existing = await client.getMemberByEmail(email);
      if (existing) {
        res.status(409).json(scimError(409, `User ${email} already exists in workspace`, 'uniqueness'));
        return;
      }

      // Default role: editor (developer). IdP sets group membership separately via Groups PATCH.
      const difyRole = 'editor';
      const member = await client.inviteMember(email, difyRole);
      logger.info('User provisioned', { email, role: difyRole });

      res.status(201).json(toScimUser(member, baseUrl));
    } catch (err) {
      logger.error('POST /Users failed', { error: String(err) });
      res.status(500).json(scimError(500, 'Failed to provision user'));
    }
  });

  // PUT /scim/v2/Users/:id — full replace (treat as role update + active flag)
  router.put('/:id', async (req: Request, res: Response) => {
    try {
      const body = req.body as Partial<ScimUser>;
      const member = await client.getMember(req.params.id);
      if (!member) {
        res.status(404).json(scimError(404, `User ${req.params.id} not found`));
        return;
      }

      // Deprovision if active=false
      if (body.active === false) {
        await client.removeMember(req.params.id);
        logger.info('User deprovisioned via PUT active=false', { id: req.params.id });
        res.status(204).send();
        return;
      }

      // Otherwise treat as role update (role comes from group assignment, not PUT body)
      res.json(toScimUser(member, baseUrl));
    } catch (err) {
      logger.error('PUT /Users/:id failed', { id: req.params.id, error: String(err) });
      res.status(500).json(scimError(500, 'Failed to update user'));
    }
  });

  // PATCH /scim/v2/Users/:id — partial update (most common: active=false for suspend)
  router.patch('/:id', async (req: Request, res: Response) => {
    try {
      const body = req.body as ScimPatchOp;
      const member = await client.getMember(req.params.id);
      if (!member) {
        res.status(404).json(scimError(404, `User ${req.params.id} not found`));
        return;
      }

      for (const op of body.Operations ?? []) {
        const val = op.value as Record<string, unknown> | boolean | null;

        // Standard deprovision: PATCH {"op":"replace","path":"active","value":false}
        if (
          op.op === 'replace' &&
          (op.path === 'active' || (typeof val === 'object' && val !== null && val['active'] === false))
        ) {
          const activeValue = op.path === 'active' ? val : (val as Record<string, unknown>)['active'];
          if (activeValue === false) {
            await client.removeMember(req.params.id);
            logger.info('User deprovisioned via PATCH active=false', { id: req.params.id });
            res.status(204).send();
            return;
          }
        }

        // Role change via group membership value
        if (op.op === 'replace' && op.path === 'roles' && Array.isArray(val)) {
          const roles = val as Array<{ value: string }>;
          const groupName = roles[0]?.value;
          const difyRole = GROUP_TO_DIFY_ROLE[groupName] ?? member.role;
          await client.updateMemberRole(req.params.id, difyRole);
          logger.info('User role updated via PATCH', { id: req.params.id, role: difyRole });
        }
      }

      const updated = await client.getMember(req.params.id);
      res.json(toScimUser(updated ?? member, baseUrl));
    } catch (err) {
      logger.error('PATCH /Users/:id failed', { id: req.params.id, error: String(err) });
      res.status(500).json(scimError(500, 'Failed to patch user'));
    }
  });

  // DELETE /scim/v2/Users/:id — hard deprovision
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      await client.removeMember(req.params.id);
      logger.info('User deleted', { id: req.params.id });
      res.status(204).send();
    } catch (err) {
      logger.error('DELETE /Users/:id failed', { id: req.params.id, error: String(err) });
      res.status(500).json(scimError(500, 'Failed to delete user'));
    }
  });

  // Suppress unused import warning
  void DIFY_ROLE_TO_GROUP;

  return router;
}
