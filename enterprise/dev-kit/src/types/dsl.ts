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
  | 'KnowledgeBase'
  | 'Plugin'
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
  | 'ToolNode'
  | 'HumanInputNode';

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
// Workflow DSL Types
// ─────────────────────────────────────────────────────────────

/** Variable reference in a workflow, e.g. "{{inputs.topic}}" or a static value */
export type WorkflowVarRef = string;

export interface WorkflowInput {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'integer' | 'array' | 'object' | 'file';
  required?: boolean;
  description?: string;
  default?: unknown;
}

export interface WorkflowOutput {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'integer' | 'array' | 'object' | 'file';
  description?: string;
  /** Variable reference that maps to this output, e.g. "{{steps.llm.output}}" */
  value: WorkflowVarRef;
}

// ── Step Definitions ─────────────────────────────────────────

export interface LLMStepConfig {
  /** Model provider, e.g. "openai" or "anthropic" */
  provider?: string;
  /** Model name, e.g. "gpt-4o" or "claude-sonnet-4-6" */
  model?: string;
  /** System prompt (supports {{var}} interpolation) */
  systemPrompt?: string;
  /** User prompt template */
  prompt: WorkflowVarRef;
  /** Max tokens */
  maxTokens?: number;
  /** Temperature (0-2) */
  temperature?: number;
  /** Output variable name (defaults to step id) */
  outputVariable?: string;
}

export interface ToolStepConfig {
  /** Tool reference: "ref:<provider>.<operationId>" or "builtin:<name>" */
  tool: string;
  /** Input mappings: key → variable reference or literal */
  inputs: Record<string, WorkflowVarRef>;
  /** Output variable name */
  outputVariable?: string;
}

export interface ConditionBranch {
  /** Condition expression, e.g. "{{steps.classify.output}} == 'tech'" */
  condition: string;
  /** Steps to execute when condition is true */
  steps: WorkflowStep[];
}

export interface ConditionStepConfig {
  branches: ConditionBranch[];
  /** Default branch steps when no condition matches */
  default?: WorkflowStep[];
}

export interface IterationStepConfig {
  /** Collection variable reference, e.g. "{{inputs.items}}" */
  over: WorkflowVarRef;
  /** Variable name for current item */
  itemVariable: string;
  /** Steps to execute per iteration */
  steps: WorkflowStep[];
  /** Max concurrency for parallel iteration */
  concurrency?: number;
}

export interface CodeStepConfig {
  /** Supported runtime */
  runtime: 'python3' | 'nodejs';
  /** Inline code (use | in YAML for multiline) */
  code: string;
  /** Input variable bindings */
  inputs: Record<string, WorkflowVarRef>;
  /** Output variable name */
  outputVariable?: string;
}

export interface KnowledgeRetrievalStepConfig {
  /** Knowledge base reference: "ref:<knowledge-base-name>" */
  knowledgeBase: string;
  /** Query variable reference */
  query: WorkflowVarRef;
  /** Number of results to retrieve */
  topK?: number;
  /** Score threshold (0-1) */
  scoreThreshold?: number;
  /** Output variable name */
  outputVariable?: string;
}

/** Human-in-the-Loop approval step (external notification channel) */
export interface HITLStepConfig {
  /** Notification channel: "slack", "email", "webhook" */
  channel: 'slack' | 'email' | 'webhook';
  /** Message to display to the approver (supports {{var}} interpolation) */
  message: WorkflowVarRef;
  /** Timeout in seconds before auto-action */
  timeoutSeconds?: number;
  /** Action when timeout is reached: "approve" | "reject" | "error" */
  onTimeout?: 'approve' | 'reject' | 'error';
  /** Webhook URL for channel === 'webhook' */
  webhookUrl?: string;
  /** Slack channel for channel === 'slack' */
  slackChannel?: string;
  /** Email recipients for channel === 'email' */
  emailRecipients?: string[];
  /** Output variable name for the approval decision */
  outputVariable?: string;
}

/**
 * Native Dify v1.13 Human Input node.
 * Pauses workflow execution in the Dify UI, allowing a human operator to
 * review AI outputs, edit variables, and choose a routing action before
 * the workflow resumes. Execution state is persisted via Celery + Redis.
 */
export interface HumanInputNodeConfig {
  /**
   * Custom action buttons presented to the reviewer.
   * Each action maps to a downstream branch (condition node) by name.
   * Defaults to ["approve", "reject"] if omitted.
   */
  actions?: string[];
  /**
   * Variables that the reviewer is allowed to edit in the Dify UI before
   * resuming. References use the "{{step_id.variable}}" syntax.
   */
  editableVars?: WorkflowVarRef[];
  /** Seconds before the node auto-times-out; 0 means no timeout. */
  timeoutSeconds?: number;
  /** Action to take on timeout: default is "reject". */
  onTimeout?: 'approve' | 'reject' | 'error';
  /**
   * Optional instruction text shown in the reviewer UI.
   * Supports {{var}} interpolation.
   */
  instructions?: WorkflowVarRef;
  /** Output variable that holds the selected action name after resumption. */
  outputVariable?: string;
}

export interface AgentStepConfig {
  /** Agent reference: "ref:<agent-name>" */
  agent: string;
  /** Input variable mappings */
  inputs: Record<string, WorkflowVarRef>;
  /** Output variable name */
  outputVariable?: string;
}

export type WorkflowStepKind =
  | 'llm'
  | 'tool'
  | 'condition'
  | 'iteration'
  | 'code'
  | 'knowledge'
  | 'hitl'
  | 'humanInput'
  | 'agent';

export interface WorkflowStep {
  /** Step identifier (unique within the workflow) */
  id: string;
  /** Human-readable step name */
  name?: string;
  /** Step type */
  kind: WorkflowStepKind;
  /** Dependencies (other step ids that must complete first) */
  dependsOn?: string[];
  /** Step-specific configuration */
  config:
    | LLMStepConfig
    | ToolStepConfig
    | ConditionStepConfig
    | IterationStepConfig
    | CodeStepConfig
    | KnowledgeRetrievalStepConfig
    | HITLStepConfig
    | HumanInputNodeConfig
    | AgentStepConfig;
}

export interface WorkflowSpec {
  /** Workflow-level inputs */
  inputs?: WorkflowInput[];
  /** Workflow-level outputs */
  outputs?: WorkflowOutput[];
  /** Ordered steps (dependency graph is derived from dependsOn + order) */
  steps: WorkflowStep[];
  /** Error handling strategy */
  onError?: 'stop' | 'continue' | 'retry';
  /** Max retry count on transient errors */
  maxRetries?: number;
  /** Timeout in seconds for the entire workflow */
  timeoutSeconds?: number;
}

export interface WorkflowDSL {
  apiVersion: string;
  kind: 'Workflow';
  metadata: DSLMetadata;
  spec: WorkflowSpec;
}

// ─────────────────────────────────────────────────────────────
// Agent DSL Types
// ─────────────────────────────────────────────────────────────

export interface AgentMemoryConfig {
  /** Memory strategy */
  type: 'conversation' | 'knowledge' | 'none';
  /** Max conversation turns to retain */
  windowSize?: number;
  /** Knowledge base references */
  knowledgeBases?: string[];
}

export interface AgentGuardrail {
  /** Type of guardrail */
  type: 'content_filter' | 'sensitive_info' | 'length_limit' | 'custom';
  /** Applies to input, output, or both */
  applies: 'input' | 'output' | 'both';
  /** Custom instructions for guardrail behavior */
  instructions?: string;
  /** Max token length (for length_limit) */
  maxTokens?: number;
}

export interface AgentToolBinding {
  /** Tool reference: "ref:<provider>.<operationId>" or "builtin:<name>" */
  ref: string;
  /** Override display name */
  name?: string;
  /** Override description */
  description?: string;
}

export interface AgentSpec {
  /** LLM model configuration */
  model?: {
    provider?: string;
    name?: string;
    temperature?: number;
    maxTokens?: number;
  };
  /** Agent system prompt (the agent's persona and instructions) */
  systemPrompt: string;
  /** Tools available to this agent */
  tools?: AgentToolBinding[];
  /** Memory configuration */
  memory?: AgentMemoryConfig;
  /** Guardrails for safety */
  guardrails?: AgentGuardrail[];
  /** Opening statement shown to users */
  openingStatement?: string;
  /** Suggested first-turn questions */
  suggestedQuestions?: string[];
  /** Max agent iterations before stopping */
  maxIterations?: number;
  /** Dify v1.6+: expose this Agent as an outbound MCP Server endpoint. */
  mcpExport?: McpExportConfig;
}

export interface AgentDSL {
  apiVersion: string;
  kind: 'Agent';
  metadata: DSLMetadata;
  spec: AgentSpec;
}

// ─────────────────────────────────────────────────────────────
// Multi-Agent Orchestration DSL Types
// ─────────────────────────────────────────────────────────────

export type AgentRole = 'supervisor' | 'worker' | 'critic' | 'planner' | 'executor';

export interface OrchestrationAgentConfig {
  /** Reference to an AgentDSL file: "ref:<agent-name>" */
  ref: string;
  /** Role in the multi-agent team */
  role: AgentRole;
  /** Display name override */
  name?: string;
}

export interface OrchestrationSpec {
  /** Team of agents */
  agents: OrchestrationAgentConfig[];
  /** Coordination strategy */
  strategy: 'supervisor' | 'round_robin' | 'parallel' | 'sequential';
  /** Supervisor agent ref (required when strategy === 'supervisor') */
  supervisor?: string;
  /** Max rounds of agent interaction */
  maxRounds?: number;
  /** Shared context variables */
  sharedContext?: Record<string, unknown>;
  /** Output format */
  outputFormat?: 'last_agent' | 'aggregated' | 'supervisor_decision';
}

export interface OrchestrationDSL {
  apiVersion: string;
  kind: 'Orchestration';
  metadata: DSLMetadata;
  spec: OrchestrationSpec;
}

// ─────────────────────────────────────────────────────────────
// Chatflow DSL Types
// ─────────────────────────────────────────────────────────────

/**
 * Dify v1.6+ outbound MCP export configuration.
 * Exposes this App/Agent as a standard MCP Server endpoint so that external
 * clients (Cursor, Claude Desktop, other Dify instances) can call it as a tool.
 */
export interface McpExportConfig {
  /** Whether to expose this component as an MCP Server. */
  enabled: boolean;
  /**
   * Authentication mode for inbound MCP clients.
   * - "pre-authorized": clients must supply a pre-generated token.
   * - "auth-free": no token required (suitable for internal networks only).
   */
  authMode?: 'pre-authorized' | 'auth-free';
  /** Human-readable description shown in the MCP tool manifest. */
  description?: string;
  /** Optional path suffix for the MCP endpoint (default: /<app-id>/mcp). */
  pathSuffix?: string;
}

export interface ChatflowSpec {
  /** Underlying agent reference */
  agent?: string;
  /** System prompt */
  systemPrompt?: string;
  /** Model configuration */
  model?: {
    provider?: string;
    name?: string;
    temperature?: number;
  };
  /** Knowledge bases for retrieval */
  knowledgeBases?: string[];
  /** Opening statement */
  openingStatement?: string;
  /** Suggested questions */
  suggestedQuestions?: string[];
  /** Workflow triggered on each user message */
  preprocessWorkflow?: string;
  /** Dify v1.6+: expose this Chatflow as an outbound MCP Server endpoint. */
  mcpExport?: McpExportConfig;
}

export interface ChatflowDSL {
  apiVersion: string;
  kind: 'Chatflow';
  metadata: DSLMetadata;
  spec: ChatflowSpec;
}

// ─────────────────────────────────────────────────────────────
// Knowledge Base DSL Types (Dify v1.12+)
// ─────────────────────────────────────────────────────────────

export interface KnowledgeBaseRetrievalConfig {
  /**
   * Retrieval strategy.
   * - "vector": pure embedding similarity search.
   * - "fulltext": keyword-based BM25 search.
   * - "hybrid": weighted combination of vector + fulltext (recommended).
   */
  mode?: 'vector' | 'fulltext' | 'hybrid';
  /** Dify v1.12: attach a summary to each chunk for better co-retrieval. */
  summaryIndex?: boolean;
  /** Multimodal retrieval configuration (Dify v1.12+). */
  multimodal?: {
    /** Enable image vectorisation alongside text. */
    enabled: boolean;
    /** Embedding model that supports multimodal input. */
    embeddingModel?: string;
    /** Automatically extract images referenced in Markdown. */
    imageExtract?: boolean;
  };
  /** Number of chunks to return per query. */
  topK?: number;
  /** Minimum similarity score threshold (0–1). */
  scoreThreshold?: number;
}

export interface KnowledgeBaseSpec {
  /** Human-readable description of what this knowledge base contains. */
  description?: string;
  retrieval?: KnowledgeBaseRetrievalConfig;
  /** Embedding model provider (e.g. "openai"). */
  embeddingProvider?: string;
  /** Embedding model name (e.g. "text-embedding-3-large"). */
  embeddingModel?: string;
  /** Chunking strategy */
  chunking?: {
    /** Max characters per chunk. */
    maxChunkSize?: number;
    /** Overlap characters between consecutive chunks. */
    chunkOverlap?: number;
    /** Separator used to split documents. */
    separator?: string;
  };
}

export interface KnowledgeBaseDSL {
  apiVersion: string;
  kind: 'KnowledgeBase';
  metadata: DSLMetadata;
  spec: KnowledgeBaseSpec;
}

// ─────────────────────────────────────────────────────────────
// Plugin DSL Types (Dify v1.6+ Marketplace)
// ─────────────────────────────────────────────────────────────

export type PluginSource = 'marketplace' | 'git' | 'local';

export interface PluginSpec {
  /**
   * Where the plugin comes from.
   * - "marketplace": official Dify Marketplace (marketplace.dify.ai).
   * - "git": install from a GitHub/GitLab repository URL.
   * - "local": install from a local directory (dev/test only).
   */
  source: PluginSource;
  /**
   * Marketplace plugin identifier in "<author>/<plugin-name>" format.
   * Required when source === "marketplace".
   */
  pluginId?: string;
  /**
   * Git repository URL.
   * Required when source === "git".
   */
  gitUrl?: string;
  /**
   * Git ref (branch, tag, or commit SHA) to install from.
   * Defaults to the repository's default branch.
   */
  gitRef?: string;
  /**
   * Local filesystem path to the plugin directory.
   * Required when source === "local".
   */
  localPath?: string;
  /**
   * Semver range or exact version to install from the marketplace.
   * Examples: "^1.0.0", "~2.3.1", "1.4.0".
   * Ignored when source !== "marketplace".
   */
  version?: string;
  /**
   * Plugin-specific configuration key-value pairs.
   * Supports ${ENV_VAR} substitution.
   */
  config?: Record<string, string>;
}

export interface PluginDSL {
  apiVersion: string;
  kind: 'Plugin';
  metadata: DSLMetadata;
  spec: PluginSpec;
}

// ─────────────────────────────────────────────────────────────
// Union Component DSL
// ─────────────────────────────────────────────────────────────

export type ComponentDSL =
  | ToolDSL
  | WorkflowDSL
  | AgentDSL
  | OrchestrationDSL
  | ChatflowDSL
  | KnowledgeBaseDSL
  | PluginDSL;
