/**
 * DSL Type Definitions for Dify DevKit
 *
 * Defines the TypeScript types for the YAML-based DSL that users write
 * to declare Dify components (tools, agents, workflows, etc.).
 */

// ─────────────────────────────────────────────────────────────
// Component Kind Enum
// ─────────────────────────────────────────────────────────────

export type ComponentKind =
  | 'Tool'
  | 'Agent'
  | 'Workflow'
  | 'Chatflow'
  | 'Chatbot'
  | 'TextGenerator'
  | 'KnowledgeRetrieval'
  | 'LLMNode'
  | 'CodeNode'
  | 'ConditionNode'
  | 'VariableAggregatorNode'
  | 'TemplateTransformNode'
  | 'QuestionClassifierNode'
  | 'HttpRequestNode'
  | 'EndNode'
  | 'StartNode'
  | 'AnswerNode'
  | 'IterationNode'
  | 'LoopNode'
  | 'ParameterExtractorNode'
  | 'ListOperatorNode'
  | 'DocumentExtractorNode'
  | 'KnowledgeRetrievalNode'
  | 'AgentNode'
  | 'ToolNode';

// ─────────────────────────────────────────────────────────────
// Shared Metadata
// ─────────────────────────────────────────────────────────────

export interface DSLMetadata {
  /** Human-readable name of the component */
  name: string;
  /** Short description */
  description?: string;
  /** Icon identifier or emoji */
  icon?: string;
  /** Semantic version of the component */
  version?: string;
  /** Author or team name */
  author?: string;
  /** Labels for categorization */
  labels?: string[];
  /** Arbitrary key-value annotations */
  annotations?: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────
// Tool DSL Types
// ─────────────────────────────────────────────────────────────

export interface ToolInput {
  /** Parameter name */
  name: string;
  /** Parameter type */
  type: 'string' | 'number' | 'boolean' | 'integer' | 'array' | 'object' | 'file';
  /** Whether the parameter is required */
  required?: boolean;
  /** Human-readable description */
  description?: string;
  /** Default value */
  default?: unknown;
  /** Allowed enum values */
  enum?: unknown[];
}

export interface ToolOutput {
  /** Output field name */
  name: string;
  /** Output type */
  type: 'string' | 'number' | 'boolean' | 'integer' | 'array' | 'object' | 'file';
  /** Human-readable description */
  description?: string;
}

export interface ToolEndpoint {
  /** API path (e.g. /v1/search) */
  path: string;
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';
  /** Unique operation identifier */
  operationId: string;
  /** Short summary */
  summary?: string;
  /** Detailed description */
  description?: string;
  /** Input parameters */
  inputs?: ToolInput[];
  /** Expected outputs */
  outputs?: ToolOutput[];
}

export interface MCPTool {
  /** Tool name as exposed by the MCP server */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Input schema (JSON Schema-like) */
  inputs?: ToolInput[];
  /** Expected outputs */
  outputs?: ToolOutput[];
}

export interface ToolSpec {
  /** Provider type */
  type: 'api' | 'mcp';
  /** Protocol version or name */
  protocol?: string;
  /** Server base URL (for API tools) or MCP server identifier */
  server?: string | { url: string; timeout?: number };
  /** Authentication configuration */
  authentication?: {
    type: 'none' | 'api_key' | 'bearer' | 'basic' | 'oauth2';
    /** Key name in header or query parameter */
    keyName?: string;
    /** Key location: header or query */
    keyLocation?: 'header' | 'query';
    /** For OAuth2: token URL */
    tokenUrl?: string;
    /** For OAuth2: authorization URL */
    authorizationUrl?: string;
    /** For OAuth2: scopes */
    scopes?: string[];
  };
  /** API endpoints (for type === 'api') */
  endpoints?: ToolEndpoint[];
  /** MCP tools (for type === 'mcp') */
  tools?: MCPTool[];
}

export interface ToolDSL {
  /** DSL API version */
  apiVersion: string;
  /** Must be "Tool" */
  kind: 'Tool';
  /** Component metadata */
  metadata: DSLMetadata;
  /** Tool specification */
  spec: ToolSpec;
}

// ─────────────────────────────────────────────────────────────
// Union Component DSL
// ─────────────────────────────────────────────────────────────

/** Union of all supported component DSL shapes. Currently only ToolDSL is defined. */
export type ComponentDSL = ToolDSL;
