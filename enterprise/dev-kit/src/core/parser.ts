/**
 * YAML DSL Parser with Zod Validation
 *
 * Parses YAML content into TypeScript objects and validates against Zod schemas.
 * Supports Tool DSL (API and MCP types).
 */

import * as fs from 'fs';
import * as yaml from 'yaml';
import { z, ZodError } from 'zod';
import { ToolDSL, ComponentDSL } from '../types/dsl';

// ─────────────────────────────────────────────────────────────
// ParseError
// ─────────────────────────────────────────────────────────────

export class ParseError extends Error {
  public readonly details: z.ZodIssue[];

  constructor(message: string, details: z.ZodIssue[]) {
    super(message);
    this.name = 'ParseError';
    this.details = details;
  }
}

// ─────────────────────────────────────────────────────────────
// Zod Schemas
// ─────────────────────────────────────────────────────────────

export const ToolInputSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'integer', 'array', 'object', 'file']),
  required: z.boolean().optional(),
  description: z.string().optional(),
  default: z.unknown().optional(),
  enum: z.array(z.unknown()).optional(),
});

export const ToolOutputSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'integer', 'array', 'object', 'file']),
  description: z.string().optional(),
});

export const ToolEndpointSchema = z.object({
  path: z.string(),
  method: z.preprocess(
    (val) => typeof val === 'string' ? val.toUpperCase() : val,
    z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'])
  ).pipe(z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'])) as z.ZodSchema<'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD'>,
  operationId: z.string(),
  summary: z.string().optional(),
  description: z.string().optional(),
  inputs: z.array(ToolInputSchema).optional(),
  outputs: z.array(ToolOutputSchema).optional(),
});

export const MCPToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputs: z.array(ToolInputSchema).optional(),
  outputs: z.array(ToolOutputSchema).optional(),
});

export const MetadataSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  version: z.string().optional(),
  author: z.string().optional(),
  labels: z.array(z.string()).optional(),
  annotations: z.record(z.string()).optional(),
});

export const ToolSpecSchema = z.object({
  type: z.enum(['api', 'mcp']),
  protocol: z.string().optional(),
  server: z.union([
    z.string(),
    z.object({
      url: z.string(),
      timeout: z.number().optional(),
    }),
  ]).optional(),
  authentication: z.object({
    type: z.enum(['none', 'api_key', 'bearer', 'basic', 'oauth2']),
    keyName: z.string().optional(),
    keyLocation: z.enum(['header', 'query']).optional(),
    tokenUrl: z.string().optional(),
    authorizationUrl: z.string().optional(),
    scopes: z.array(z.string()).optional(),
  }).optional(),
  endpoints: z.array(ToolEndpointSchema).optional(),
  tools: z.array(MCPToolSchema).optional(),
});

export const ToolDSLSchema = z.object({
  apiVersion: z.string(),
  kind: z.literal('Tool'),
  metadata: MetadataSchema,
  spec: ToolSpecSchema,
});

// ─────────────────────────────────────────────────────────────
// Generic DSL Parser
// ─────────────────────────────────────────────────────────────

/**
 * Parse YAML string and validate against a Zod schema.
 *
 * @param content - Raw YAML string
 * @param schema - Zod schema to validate against
 * @returns Parsed and validated object
 * @throws ParseError on validation failure
 */
export function parseDSL<T>(content: string, schema: z.ZodSchema<T>): T {
  let parsed: unknown;
  try {
    parsed = yaml.parse(content);
  } catch (yamlError) {
    const message = yamlError instanceof Error ? yamlError.message : 'YAML parse error';
    throw new ParseError(message, [
      { message, code: 'custom', path: [] } as z.ZodIssue,
    ]);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new ParseError('DSL validation failed', result.error.issues);
  }

  return result.data;
}

// ─────────────────────────────────────────────────────────────
// Tool DSL Parser
// ─────────────────────────────────────────────────────────────

/**
 * Parse a Tool DSL YAML string.
 *
 * @param content - Raw YAML string
 * @returns Validated ToolDSL object
 * @throws ParseError on validation failure
 */
export function parseToolDSL(content: string): ToolDSL {
  return parseDSL(content, ToolDSLSchema);
}

/**
 * Read a YAML file and parse it as a Tool DSL.
 *
 * @param filePath - Path to the YAML file
 * @returns Validated ToolDSL object
 * @throws ParseError on validation failure
 */
export function parseToolDSLFromFile(filePath: string): ToolDSL {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parseToolDSL(content);
}
