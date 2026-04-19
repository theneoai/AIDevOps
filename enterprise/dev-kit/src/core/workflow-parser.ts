/**
 * Workflow DSL Parser with Zod Validation
 *
 * Parses and validates Workflow, Agent, Orchestration, and Chatflow DSL
 * YAML documents. Uses a shared ParseError for consistent error reporting.
 */

import * as fs from 'fs';
import * as yaml from 'yaml';
import { z, ZodError } from 'zod';
import {
  WorkflowDSL,
  AgentDSL,
  OrchestrationDSL,
  ChatflowDSL,
  ComponentDSL,
} from '../types/dsl';
import { ParseError, parseDSL, MetadataSchema, ToolDSLSchema } from './parser';

// ─────────────────────────────────────────────────────────────
// Re-export ParseError for consumers
// ─────────────────────────────────────────────────────────────

export { ParseError };

// ─────────────────────────────────────────────────────────────
// Shared Sub-Schemas
// ─────────────────────────────────────────────────────────────

const VarRefSchema = z.string();

const WorkflowInputSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'integer', 'array', 'object', 'file']),
  required: z.boolean().optional(),
  description: z.string().optional(),
  default: z.unknown().optional(),
});

const WorkflowOutputSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'integer', 'array', 'object', 'file']),
  description: z.string().optional(),
  value: VarRefSchema,
});

// ─────────────────────────────────────────────────────────────
// Step Config Schemas
// ─────────────────────────────────────────────────────────────

const LLMStepConfigSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  prompt: VarRefSchema,
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  outputVariable: z.string().optional(),
});

const ToolStepConfigSchema = z.object({
  tool: z.string(),
  inputs: z.record(VarRefSchema),
  outputVariable: z.string().optional(),
});

const CodeStepConfigSchema = z.object({
  runtime: z.enum(['python3', 'nodejs']),
  code: z.string(),
  inputs: z.record(VarRefSchema),
  outputVariable: z.string().optional(),
});

const KnowledgeRetrievalStepConfigSchema = z.object({
  knowledgeBase: z.string(),
  query: VarRefSchema,
  topK: z.number().int().positive().optional(),
  scoreThreshold: z.number().min(0).max(1).optional(),
  outputVariable: z.string().optional(),
});

const HITLStepConfigSchema = z.object({
  channel: z.enum(['slack', 'email', 'webhook']),
  message: VarRefSchema,
  timeoutSeconds: z.number().int().positive().optional(),
  onTimeout: z.enum(['approve', 'reject', 'error']).optional(),
  webhookUrl: z.string().url().optional(),
  slackChannel: z.string().optional(),
  emailRecipients: z.array(z.string().email()).optional(),
  outputVariable: z.string().optional(),
});

const AgentStepConfigSchema = z.object({
  agent: z.string(),
  inputs: z.record(VarRefSchema),
  outputVariable: z.string().optional(),
});

// ── Condition + Iteration (recursive via lazy) ───────────────

const WorkflowStepKindSchema = z.enum([
  'llm', 'tool', 'condition', 'iteration', 'code', 'knowledge', 'hitl', 'agent',
]);

// Use lazy for recursive condition/iteration steps.
// config is validated as unknown here and re-checked via superRefine based on kind.
const BaseWorkflowStepSchema = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, 'Step id must start with a letter and contain only alphanumeric, _, - characters'),
  name: z.string().optional(),
  kind: WorkflowStepKindSchema,
  dependsOn: z.array(z.string()).optional(),
  config: z.unknown(),
});

type WorkflowStepType = z.infer<typeof BaseWorkflowStepSchema>;

// Nested step schema (same shape, recursive for condition/iteration)
const WorkflowStepSchema: z.ZodType<WorkflowStepType> = z.lazy(() =>
  BaseWorkflowStepSchema.superRefine((step, ctx) => {
    const cfg = step.config as Record<string, unknown> | null | undefined;
    if (!cfg || typeof cfg !== 'object') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'config must be an object', path: ['config'] });
      return;
    }
    switch (step.kind) {
      case 'llm':
        if (typeof cfg.prompt !== 'string') {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'LLM step requires config.prompt (string)', path: ['config', 'prompt'] });
        }
        break;
      case 'tool':
        if (typeof cfg.tool !== 'string') {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Tool step requires config.tool (string)', path: ['config', 'tool'] });
        }
        if (cfg.inputs === undefined || cfg.inputs === null || typeof cfg.inputs !== 'object') {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Tool step requires config.inputs (object)', path: ['config', 'inputs'] });
        }
        break;
      case 'code':
        if (!['python3', 'nodejs'].includes(cfg.runtime as string)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Code step requires config.runtime: python3 | nodejs', path: ['config', 'runtime'] });
        }
        if (typeof cfg.code !== 'string') {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Code step requires config.code (string)', path: ['config', 'code'] });
        }
        break;
      case 'knowledge':
        if (typeof cfg.knowledgeBase !== 'string') {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Knowledge step requires config.knowledgeBase (string)', path: ['config', 'knowledgeBase'] });
        }
        if (typeof cfg.query !== 'string') {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Knowledge step requires config.query (string)', path: ['config', 'query'] });
        }
        break;
      case 'hitl':
        if (!['slack', 'email', 'webhook', 'console'].includes(cfg.channel as string)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'HITL step requires config.channel: slack | email | webhook | console', path: ['config', 'channel'] });
        }
        if (typeof cfg.message !== 'string') {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'HITL step requires config.message (string)', path: ['config', 'message'] });
        }
        break;
      case 'agent':
        if (typeof cfg.agent !== 'string') {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Agent step requires config.agent (string)', path: ['config', 'agent'] });
        }
        break;
      case 'condition':
        if (!Array.isArray(cfg.branches)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Condition step requires config.branches (array)', path: ['config', 'branches'] });
        }
        break;
      case 'iteration':
        if (typeof cfg.over !== 'string') {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Iteration step requires config.over (string)', path: ['config', 'over'] });
        }
        if (typeof cfg.itemVariable !== 'string') {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Iteration step requires config.itemVariable (string)', path: ['config', 'itemVariable'] });
        }
        if (!Array.isArray(cfg.steps)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Iteration step requires config.steps (array)', path: ['config', 'steps'] });
        }
        break;
    }
  })
);

// ─────────────────────────────────────────────────────────────
// Workflow DSL Schema
// ─────────────────────────────────────────────────────────────

const WorkflowSpecSchema = z.object({
  inputs: z.array(WorkflowInputSchema).optional(),
  outputs: z.array(WorkflowOutputSchema).optional(),
  steps: z.array(WorkflowStepSchema).min(1, 'Workflow must have at least one step'),
  onError: z.enum(['stop', 'continue', 'retry']).optional(),
  maxRetries: z.number().int().nonnegative().optional(),
  timeoutSeconds: z.number().int().positive().optional(),
});

export const WorkflowDSLSchema = z.object({
  apiVersion: z.string(),
  kind: z.literal('Workflow'),
  metadata: MetadataSchema,
  spec: WorkflowSpecSchema,
});

// ─────────────────────────────────────────────────────────────
// Agent DSL Schema
// ─────────────────────────────────────────────────────────────

const AgentMemoryConfigSchema = z.object({
  type: z.enum(['conversation', 'knowledge', 'none']),
  windowSize: z.number().int().positive().optional(),
  knowledgeBases: z.array(z.string()).optional(),
});

const AgentGuardrailSchema = z.object({
  type: z.enum(['content_filter', 'sensitive_info', 'length_limit', 'custom']),
  applies: z.enum(['input', 'output', 'both']),
  instructions: z.string().optional(),
  maxTokens: z.number().int().positive().optional(),
});

const AgentToolBindingSchema = z.object({
  ref: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
});

const AgentSpecSchema = z.object({
  model: z.object({
    provider: z.string().optional(),
    name: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
  }).optional(),
  systemPrompt: z.string().min(1, 'systemPrompt is required'),
  tools: z.array(AgentToolBindingSchema).optional(),
  memory: AgentMemoryConfigSchema.optional(),
  guardrails: z.array(AgentGuardrailSchema).optional(),
  openingStatement: z.string().optional(),
  suggestedQuestions: z.array(z.string()).optional(),
  maxIterations: z.number().int().positive().optional(),
});

export const AgentDSLSchema = z.object({
  apiVersion: z.string(),
  kind: z.literal('Agent'),
  metadata: MetadataSchema,
  spec: AgentSpecSchema,
});

// ─────────────────────────────────────────────────────────────
// Orchestration DSL Schema
// ─────────────────────────────────────────────────────────────

const OrchestrationAgentConfigSchema = z.object({
  ref: z.string(),
  role: z.enum(['supervisor', 'worker', 'critic', 'planner', 'executor']),
  name: z.string().optional(),
});

const OrchestrationSpecSchema = z.object({
  agents: z.array(OrchestrationAgentConfigSchema).min(2, 'Orchestration requires at least 2 agents'),
  strategy: z.enum(['supervisor', 'round_robin', 'parallel', 'sequential']),
  supervisor: z.string().optional(),
  maxRounds: z.number().int().positive().optional(),
  sharedContext: z.record(z.unknown()).optional(),
  outputFormat: z.enum(['last_agent', 'aggregated', 'supervisor_decision']).optional(),
}).superRefine((data, ctx) => {
  if (data.strategy === 'supervisor' && !data.supervisor) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'supervisor field is required when strategy is "supervisor"',
      path: ['supervisor'],
    });
  }
});

export const OrchestrationDSLSchema = z.object({
  apiVersion: z.string(),
  kind: z.literal('Orchestration'),
  metadata: MetadataSchema,
  spec: OrchestrationSpecSchema,
});

// ─────────────────────────────────────────────────────────────
// Chatflow DSL Schema
// ─────────────────────────────────────────────────────────────

const ChatflowSpecSchema = z.object({
  agent: z.string().optional(),
  systemPrompt: z.string().optional(),
  model: z.object({
    provider: z.string().optional(),
    name: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
  }).optional(),
  knowledgeBases: z.array(z.string()).optional(),
  openingStatement: z.string().optional(),
  suggestedQuestions: z.array(z.string()).optional(),
  preprocessWorkflow: z.string().optional(),
});

export const ChatflowDSLSchema = z.object({
  apiVersion: z.string(),
  kind: z.literal('Chatflow'),
  metadata: MetadataSchema,
  spec: ChatflowSpecSchema,
});

// ─────────────────────────────────────────────────────────────
// Parser Functions
// ─────────────────────────────────────────────────────────────

export function parseWorkflowDSL(content: string): WorkflowDSL {
  return parseDSL(content, WorkflowDSLSchema) as WorkflowDSL;
}

export function parseWorkflowDSLFromFile(filePath: string): WorkflowDSL {
  return parseWorkflowDSL(fs.readFileSync(filePath, 'utf-8'));
}

export function parseAgentDSL(content: string): AgentDSL {
  return parseDSL(content, AgentDSLSchema) as AgentDSL;
}

export function parseAgentDSLFromFile(filePath: string): AgentDSL {
  return parseAgentDSL(fs.readFileSync(filePath, 'utf-8'));
}

export function parseOrchestrationDSL(content: string): OrchestrationDSL {
  return parseDSL(content, OrchestrationDSLSchema) as OrchestrationDSL;
}

export function parseOrchestrationDSLFromFile(filePath: string): OrchestrationDSL {
  return parseOrchestrationDSL(fs.readFileSync(filePath, 'utf-8'));
}

export function parseChatflowDSL(content: string): ChatflowDSL {
  return parseDSL(content, ChatflowDSLSchema) as ChatflowDSL;
}

export function parseChatflowDSLFromFile(filePath: string): ChatflowDSL {
  return parseChatflowDSL(fs.readFileSync(filePath, 'utf-8'));
}

// ─────────────────────────────────────────────────────────────
// Universal Component Parser
// ─────────────────────────────────────────────────────────────

/**
 * Parse any component DSL file by inspecting the `kind` field.
 * Supports Tool, Workflow, Agent, Orchestration, Chatflow.
 */
export function parseComponentDSLFromFile(filePath: string): ComponentDSL {
  const content = fs.readFileSync(filePath, 'utf-8');
  let raw: unknown;
  try {
    raw = yaml.parse(content);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'YAML parse error';
    throw new ParseError(msg, [{ message: msg, code: 'custom', path: [] } as z.ZodIssue]);
  }

  const kind = (raw as Record<string, unknown>)?.kind;
  switch (kind) {
    case 'Tool':          return parseDSL(content, ToolDSLSchema) as never;
    case 'Workflow':      return parseWorkflowDSL(content);
    case 'Agent':         return parseAgentDSL(content);
    case 'Orchestration': return parseOrchestrationDSL(content);
    case 'Chatflow':      return parseChatflowDSL(content);
    default:
      throw new ParseError(`Unknown component kind: "${kind}"`, [
        { message: `Unsupported kind: ${kind}`, code: 'custom', path: ['kind'] } as z.ZodIssue,
      ]);
  }
}

// ─────────────────────────────────────────────────────────────
// Validation Utilities
// ─────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ path: string; message: string }>;
  warnings: Array<{ path: string; message: string }>;
}

/** Validate a workflow for semantic issues beyond schema correctness */
export function validateWorkflowSemantics(dsl: WorkflowDSL): ValidationResult {
  const errors: Array<{ path: string; message: string }> = [];
  const warnings: Array<{ path: string; message: string }> = [];

  const stepIds = new Set<string>();

  function checkSteps(steps: WorkflowDSL['spec']['steps'], prefix: string) {
    for (const step of steps) {
      const stepPath = `${prefix}.${step.id}`;

      // Duplicate id check
      if (stepIds.has(step.id)) {
        errors.push({ path: stepPath, message: `Duplicate step id: "${step.id}"` });
      }
      stepIds.add(step.id);

      // dependsOn reference check (can only check top-level for now)
      for (const dep of step.dependsOn || []) {
        if (!stepIds.has(dep) && dep !== step.id) {
          warnings.push({ path: stepPath, message: `Step depends on "${dep}" which may not be defined before it` });
        }
      }

      // Warn on missing prompt for LLM steps
      if (step.kind === 'llm') {
        const cfg = step.config as { prompt?: string };
        if (!cfg.prompt) {
          errors.push({ path: stepPath, message: 'LLM step requires a prompt' });
        }
      }

      // Recursively check nested steps
      if (step.kind === 'condition') {
        const cfg = step.config as { branches: Array<{ steps: WorkflowDSL['spec']['steps'] }>; default?: WorkflowDSL['spec']['steps'] };
        for (const branch of cfg.branches) {
          checkSteps(branch.steps, `${stepPath}.branches`);
        }
        if (cfg.default) {
          checkSteps(cfg.default, `${stepPath}.default`);
        }
      }

      if (step.kind === 'iteration') {
        const cfg = step.config as { steps: WorkflowDSL['spec']['steps'] };
        checkSteps(cfg.steps, `${stepPath}.iteration`);
      }
    }
  }

  checkSteps(dsl.spec.steps, 'spec.steps');

  // Output reference validation
  for (const output of dsl.spec.outputs || []) {
    if (!output.value.includes('{{')) {
      warnings.push({ path: `spec.outputs.${output.name}`, message: `Output value "${output.value}" is a literal, not a variable reference` });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
