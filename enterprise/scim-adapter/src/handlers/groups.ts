/**
 * SCIM 2.0 Groups resource handlers
 *
 * Dify has fixed workspace roles (owner, admin, editor, normal).
 * We expose them as static SCIM Groups with deterministic IDs.
 * PATCH /Groups/:id with member adds/removes triggers role changes in Dify.
 *
 *   GET  /Groups         → return static group list with current members
 *   GET  /Groups/:id     → return single group
 *   PATCH /Groups/:id    → add/remove members (→ dify role update)
 */
import { Router, Request, Response } from 'express';
import { DifyMemberClient } from '../dify-client';
import {
  ScimGroup,
  ScimListResponse,
  ScimPatchOp,
  SCIM_SCHEMA_GROUP,
  SCIM_SCHEMA_LIST,
  STATIC_GROUPS,
  GROUP_TO_DIFY_ROLE,
  DIFY_ROLE_TO_GROUP,
  scimError,
} from '../scim-types';
import { createLogger } from '../logger';

const logger = createLogger('handlers/groups');

async function hydrateGroups(client: DifyMemberClient, baseUrl: string): Promise<ScimGroup[]> {
  const members = await client.listMembers();

  return STATIC_GROUPS.map((g) => {
    const groupMembers = members
      .filter((m) => DIFY_ROLE_TO_GROUP[m.role] === g.displayName)
      .map((m) => ({
        value: m.id,
        display: m.name || m.email,
        '$ref': `${baseUrl}/scim/v2/Users/${m.id}`,
      }));

    return {
      ...g,
      members: groupMembers,
      meta: {
        resourceType: 'Group',
        location: `${baseUrl}/scim/v2/Groups/${g.id}`,
      },
    };
  });
}

export function createGroupsRouter(client: DifyMemberClient, baseUrl: string): Router {
  const router = Router();

  // GET /scim/v2/Groups
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const groups = await hydrateGroups(client, baseUrl);
      const response: ScimListResponse<ScimGroup> = {
        schemas: [SCIM_SCHEMA_LIST],
        totalResults: groups.length,
        startIndex: 1,
        itemsPerPage: groups.length,
        Resources: groups,
      };
      res.json(response);
    } catch (err) {
      logger.error('GET /Groups failed', { error: String(err) });
      res.status(500).json(scimError(500, 'Failed to list groups'));
    }
  });

  // GET /scim/v2/Groups/:id
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const groups = await hydrateGroups(client, baseUrl);
      const group = groups.find((g) => g.id === req.params.id);
      if (!group) {
        res.status(404).json(scimError(404, `Group ${req.params.id} not found`));
        return;
      }
      res.json(group);
    } catch (err) {
      logger.error('GET /Groups/:id failed', { id: req.params.id, error: String(err) });
      res.status(500).json(scimError(500, 'Failed to fetch group'));
    }
  });

  // PATCH /scim/v2/Groups/:id — add/remove members (role changes)
  router.patch('/:id', async (req: Request, res: Response) => {
    try {
      const staticGroup = STATIC_GROUPS.find((g) => g.id === req.params.id);
      if (!staticGroup) {
        res.status(404).json(scimError(404, `Group ${req.params.id} not found`));
        return;
      }

      const difyRole = GROUP_TO_DIFY_ROLE[staticGroup.displayName];
      if (!difyRole) {
        res.status(400).json(scimError(400, `Group ${staticGroup.displayName} has no Dify role mapping`));
        return;
      }

      const body = req.body as ScimPatchOp;
      for (const op of body.Operations ?? []) {
        const members = (Array.isArray(op.value) ? op.value : []) as Array<{ value: string }>;

        if (op.op === 'add' && (op.path === 'members' || !op.path)) {
          // Add members to group → update their Dify role
          await Promise.all(
            members.map(async ({ value: userId }) => {
              await client.updateMemberRole(userId, difyRole);
              logger.info('Member role updated via group add', { userId, group: staticGroup.displayName, difyRole });
            }),
          );
        }

        if (op.op === 'remove' && (op.path === 'members' || !op.path)) {
          // Remove members from group → revert to default role (editor)
          await Promise.all(
            members.map(async ({ value: userId }) => {
              await client.updateMemberRole(userId, 'editor');
              logger.info('Member role reverted via group remove', { userId, group: staticGroup.displayName });
            }),
          );
        }
      }

      const groups = await hydrateGroups(client, baseUrl);
      const updated = groups.find((g) => g.id === req.params.id);
      res.json(updated ?? staticGroup);
    } catch (err) {
      logger.error('PATCH /Groups/:id failed', { id: req.params.id, error: String(err) });
      res.status(500).json(scimError(500, 'Failed to update group members'));
    }
  });

  // Dify does not support creating or deleting roles — return 501
  router.post('/', (_req: Request, res: Response) => {
    res.status(501).json(scimError(501, 'Creating groups is not supported — groups are fixed Dify roles'));
  });

  router.delete('/:id', (_req: Request, res: Response) => {
    res.status(501).json(scimError(501, 'Deleting groups is not supported — groups are fixed Dify roles'));
  });

  return router;
}
