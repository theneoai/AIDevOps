/**
 * DSL Compiler
 *
 * Transforms validated DSL into Dify's internal database format.
 */

import { createHash } from 'crypto';
import {
  ToolDSL,
  ToolSpec,
  ToolEndpoint,
  ToolInput,
  MCPTool,
} from '../types/dsl';
import { DifyApiToolProvider, DifyMCPToolProvider } from '../types/dify';

// ─────────────────────────────────────────────────────────────
// Type Mapping
// ─────────────────────────────────────────────────────────────

/**
 * Map DSL parameter types to Dify internal types.
 * Dify uses 'string' | 'number' | 'boolean' (no 'integer').
 */
function mapDifyType(type: string): 'string' | 'number' | 'boolean' {
  if (type === 'integer') return 'number';
  if (type === 'string' || type === 'number' || type === 'boolean') return type;
  return 'string';
}

// ─────────────────────────────────────────────────────────────
// Parameter Builder
// ─────────────────────────────────────────────────────────────

export interface DifyParameter {
  name: string;
  label: { en_US: string; zh_Hans: string };
  type: 'string' | 'number' | 'boolean';
  form: 'llm';
  llm_description: string;
  required: boolean;
  default?: unknown;
}

function buildDifyParameter(input: ToolInput): DifyParameter {
  return {
    name: input.name,
    label: {
      en_US: input.name,
      zh_Hans: input.description || input.name,
    },
    type: mapDifyType(input.type),
    form: 'llm',
    llm_description: input.description || '',
    required: input.required ?? false,
    ...(input.default !== undefined ? { default: input.default } : {}),
  };
}

// ─────────────────────────────────────────────────────────────
// OpenAPI Schema Builder
// ─────────────────────────────────────────────────────────────

function buildJsonSchemaType(type: string): string {
  if (type === 'integer') return 'integer';
  if (type === 'number') return 'number';
  if (type === 'boolean') return 'boolean';
  if (type === 'array') return 'array';
  if (type === 'object') return 'object';
  return 'string';
}

function buildOpenApiSchemaFromEndpoint(endpoint: ToolEndpoint): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const input of endpoint.inputs || []) {
    const prop: Record<string, unknown> = {
      type: buildJsonSchemaType(input.type),
    };
    if (input.description) {
      prop.description = input.description;
    }
    if (input.enum !== undefined) {
      prop.enum = input.enum;
    }
    if (input.default !== undefined) {
      prop.default = input.default;
    }
    properties[input.name] = prop;

    if (input.required) {
      required.push(input.name);
    }
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function buildOpenApiSchema(dsl: ToolDSL): Record<string, unknown> {
  const endpoints = dsl.spec.endpoints || [];
  const paths: Record<string, Record<string, unknown>> = {};

  for (const ep of endpoints) {
    if (!paths[ep.path]) {
      paths[ep.path] = {};
    }

    const operation: Record<string, unknown> = {
      operationId: ep.operationId,
      summary: ep.summary || ep.operationId,
    };

    if (ep.description) {
      operation.description = ep.description;
    }

    const requestBody: Record<string, unknown> = {
      content: {
        'application/json': {
          schema: buildOpenApiSchemaFromEndpoint(ep),
        },
      },
    };

    operation.requestBody = requestBody;

    // Build responses from outputs
    const responseSchema: Record<string, unknown> = {
      type: 'object',
      properties: {},
    };
    for (const output of ep.outputs || []) {
      (responseSchema.properties as Record<string, unknown>)[output.name] = {
        type: buildJsonSchemaType(output.type),
        ...(output.description ? { description: output.description } : {}),
      };
    }

    operation.responses = {
      '200': {
        description: 'Success',
        content: {
          'application/json': {
            schema: responseSchema,
          },
        },
      },
    };

    paths[ep.path][ep.method.toLowerCase()] = operation;
  }

  const serverUrl =
    typeof dsl.spec.server === 'string'
      ? dsl.spec.server
      : dsl.spec.server?.url || '';

  const schema: Record<string, unknown> = {
    openapi: '3.0.0',
    info: {
      title: dsl.metadata.name,
      version: dsl.metadata.version || '1.0.0',
      description: dsl.metadata.description || '',
    },
    servers: serverUrl ? [{ url: serverUrl }] : [],
    paths,
  };

  return schema;
}

// ─────────────────────────────────────────────────────────────
// tools_str Builder
// ─────────────────────────────────────────────────────────────

function buildToolsStr(dsl: ToolDSL): string {
  const tools: Array<{
    name: string;
    label: { en_US: string; zh_Hans: string };
    description: string;
    parameters: DifyParameter[];
  }> = [];

  if (dsl.spec.type === 'api') {
    for (const ep of dsl.spec.endpoints || []) {
      const parameters = (ep.inputs || []).map(buildDifyParameter);
      tools.push({
        name: ep.operationId,
        label: {
          en_US: ep.summary || ep.operationId,
          zh_Hans: ep.summary || ep.operationId,
        },
        description: ep.description || ep.summary || ep.operationId,
        parameters,
      });
    }
  } else {
    for (const tool of dsl.spec.tools || []) {
      const parameters = (tool.inputs || []).map(buildDifyParameter);
      tools.push({
        name: tool.name,
        label: {
          en_US: tool.name,
          zh_Hans: tool.description || tool.name,
        },
        description: tool.description || tool.name,
        parameters,
      });
    }
  }

  return JSON.stringify(tools);
}

// ─────────────────────────────────────────────────────────────
// Credentials Builder
// ─────────────────────────────────────────────────────────────

function buildCredentials(spec: ToolSpec): Record<string, unknown> | undefined {
  if (!spec.authentication || spec.authentication.type === 'none') {
    return undefined;
  }

  const auth = spec.authentication;
  const creds: Record<string, unknown> = {
    auth_type: auth.type,
  };

  if (auth.keyName) {
    creds.key = auth.keyName;
  }
  if (auth.keyLocation) {
    creds.location = auth.keyLocation;
  }
  if (auth.tokenUrl) {
    creds.token_url = auth.tokenUrl;
  }
  if (auth.authorizationUrl) {
    creds.authorization_url = auth.authorizationUrl;
  }
  if (auth.scopes) {
    creds.scopes = auth.scopes;
  }

  return creds;
}

// ─────────────────────────────────────────────────────────────
// MCP Config Builder
// ─────────────────────────────────────────────────────────────

function buildMcpConfig(dsl: ToolDSL): Record<string, unknown> {
  const serverUrl =
    typeof dsl.spec.server === 'string'
      ? dsl.spec.server
      : dsl.spec.server?.url || '';

  return {
    server_url: serverUrl,
    tools: (dsl.spec.tools || []).map((tool) => ({
      name: tool.name,
      description: tool.description || '',
      parameters: (tool.inputs || []).map(buildDifyParameter),
    })),
  };
}

// ─────────────────────────────────────────────────────────────
// SHA-256 Hash
// ─────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

// ─────────────────────────────────────────────────────────────
// Compiler Functions
// ─────────────────────────────────────────────────────────────

/**
 * Compile an API-type Tool DSL into a DifyApiToolProvider.
 *
 * @param dsl - Validated ToolDSL with type === 'api'
 * @param tenantId - Tenant UUID
 * @param userId - User/account UUID
 * @returns DifyApiToolProvider ready for database insertion
 */
export function compileApiTool(
  dsl: ToolDSL,
  tenantId: string,
  userId: string
): DifyApiToolProvider {
  const openApiSchema = buildOpenApiSchema(dsl);
  const toolsStr = buildToolsStr(dsl);
  const credentials = buildCredentials(dsl.spec);

  return {
    id: userId,
    tenant_id: tenantId,
    name: dsl.metadata.name,
    label: dsl.metadata.name,
    icon: dsl.metadata.icon,
    schema: JSON.stringify(openApiSchema),
    schema_type: 'openapi',
    credentials: credentials ? JSON.stringify(credentials) : undefined,
    description: dsl.metadata.description,
    is_system: false,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

/**
 * Compile an MCP-type Tool DSL into a DifyMCPToolProvider.
 *
 * @param dsl - Validated ToolDSL with type === 'mcp'
 * @param tenantId - Tenant UUID
 * @param userId - User/account UUID
 * @returns DifyMCPToolProvider ready for database insertion
 */
export function compileMCPTool(
  dsl: ToolDSL,
  tenantId: string,
  userId: string
): DifyMCPToolProvider {
  const serverUrl =
    typeof dsl.spec.server === 'string'
      ? dsl.spec.server
      : dsl.spec.server?.url || '';

  const config = buildMcpConfig(dsl);
  const toolsStr = buildToolsStr(dsl);

  return {
    id: sha256(serverUrl),
    tenant_id: tenantId,
    name: dsl.metadata.name,
    label: dsl.metadata.name,
    icon: dsl.metadata.icon,
    config: JSON.stringify(config),
    description: dsl.metadata.description,
    is_system: false,
    created_at: new Date(),
    updated_at: new Date(),
  };
}
