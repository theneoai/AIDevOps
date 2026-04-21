/**
 * SCIM 2.0 Core Types (RFC 7643 / RFC 7644)
 *
 * Only the subset used by Dify's member management is implemented.
 * Groups map to Dify workspace roles (Owner → project_owner, etc.).
 */

export const SCIM_SCHEMA_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_SCHEMA_GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export const SCIM_SCHEMA_LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCIM_SCHEMA_ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const SCIM_SCHEMA_PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

export interface ScimMeta {
  resourceType: string;
  created?: string;
  lastModified?: string;
  location?: string;
}

export interface ScimEmail {
  value: string;
  type?: string;
  primary?: boolean;
}

export interface ScimUser {
  schemas: string[];
  id: string;
  externalId?: string;
  userName: string;
  displayName?: string;
  name?: { formatted?: string; givenName?: string; familyName?: string };
  emails: ScimEmail[];
  active: boolean;
  meta: ScimMeta;
}

export interface ScimGroupMember {
  value: string;  // SCIM user id
  display?: string;
  '$ref'?: string;
}

export interface ScimGroup {
  schemas: string[];
  id: string;
  displayName: string;
  members: ScimGroupMember[];
  meta: ScimMeta;
}

export interface ScimListResponse<T> {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

export interface ScimError {
  schemas: string[];
  status: number;
  detail: string;
  scimType?: string;
}

export function scimError(status: number, detail: string, scimType?: string): ScimError {
  return { schemas: [SCIM_SCHEMA_ERROR], status, detail, scimType };
}

export interface ScimPatchOp {
  schemas: string[];
  Operations: Array<{
    op: 'add' | 'remove' | 'replace';
    path?: string;
    value?: unknown;
  }>;
}

/** Maps a Dify role name to a SCIM Group displayName. */
export const DIFY_ROLE_TO_GROUP: Record<string, string> = {
  owner: 'workspace-owners',
  admin: 'platform-admins',
  editor: 'developers',
  normal: 'developers',
  dataset_operator: 'viewers',
};

export const GROUP_TO_DIFY_ROLE: Record<string, string> = {
  'platform-admins': 'admin',
  'workspace-owners': 'owner',
  developers: 'editor',
  viewers: 'normal',
};

/** Canonical SCIM group IDs (deterministic, config-defined). */
export const STATIC_GROUPS: ScimGroup[] = [
  { schemas: [SCIM_SCHEMA_GROUP], id: 'group-platform-admins',  displayName: 'platform-admins',  members: [], meta: { resourceType: 'Group' } },
  { schemas: [SCIM_SCHEMA_GROUP], id: 'group-workspace-owners', displayName: 'workspace-owners', members: [], meta: { resourceType: 'Group' } },
  { schemas: [SCIM_SCHEMA_GROUP], id: 'group-developers',       displayName: 'developers',       members: [], meta: { resourceType: 'Group' } },
  { schemas: [SCIM_SCHEMA_GROUP], id: 'group-viewers',          displayName: 'viewers',          members: [], meta: { resourceType: 'Group' } },
];
