/**
 * Workflow Compiler
 *
 * Transforms WorkflowDSL into Dify's internal workflow graph format.
 * Produces a DAG of nodes and edges following Dify's workflow JSON schema.
 *
 * Design principles:
 *  - Every workflow step maps to a Dify node (llm → LLMNode, tool → ToolNode, etc.)
 *  - Edges are derived from step order + dependsOn declarations
 *  - Variable references ({{steps.X.output}}) are preserved as-is; Dify resolves them
 *  - HITL steps compile to a Dify "human-input" node + approval gate
 */

import { randomUUID } from 'crypto';
import {
  WorkflowDSL,
  WorkflowStep,
  WorkflowStepKind,
  LLMStepConfig,
  ToolStepConfig,
  CodeStepConfig,
  KnowledgeRetrievalStepConfig,
  HITLStepConfig,
  AgentStepConfig,
  ConditionStepConfig,
  IterationStepConfig,
} from '../types/dsl';

// ─────────────────────────────────────────────────────────────
// Dify Workflow Graph Types
// ─────────────────────────────────────────────────────────────

export interface DifyNodePosition {
  x: number;
  y: number;
}

export interface DifyNodeData {
  title: string;
  desc?: string;
  [key: string]: unknown;
}

export interface DifyNode {
  id: string;
  type: string;
  position: DifyNodePosition;
  data: DifyNodeData;
  width?: number;
  height?: number;
}

export interface DifyEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: string;
}

export interface DifyWorkflowGraph {
  nodes: DifyNode[];
  edges: DifyEdge[];
  viewport?: { x: number; y: number; zoom: number };
}

export interface DifyWorkflowDefinition {
  graph: DifyWorkflowGraph;
  features?: Record<string, unknown>;
  environment_variables?: unknown[];
  conversation_variables?: unknown[];
}

// ─────────────────────────────────────────────────────────────
// Layout Constants
// ─────────────────────────────────────────────────────────────

const NODE_WIDTH = 244;
const NODE_HEIGHT = 98;
const NODE_GAP_X = 80;
const NODE_GAP_Y = 120;
const STEP_X_STRIDE = NODE_WIDTH + NODE_GAP_X;

// ─────────────────────────────────────────────────────────────
// Node Type Mapping
// ─────────────────────────────────────────────────────────────

const KIND_TO_DIFY_TYPE: Record<WorkflowStepKind, string> = {
  llm:       'llm',
  tool:      'tool',
  condition: 'if-else',
  iteration: 'iteration',
  code:      'code',
  knowledge: 'knowledge-retrieval',
  hitl:      'human-input',
  agent:     'agent',
};

// ─────────────────────────────────────────────────────────────
// Step → Node Compilers
// ─────────────────────────────────────────────────────────────

function compileLLMNode(step: WorkflowStep, pos: DifyNodePosition): DifyNode {
  const cfg = step.config as LLMStepConfig;
  return {
    id: step.id,
    type: 'llm',
    position: pos,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    data: {
      title: step.name || step.id,
      desc: '',
      type: 'llm',
      model: {
        provider: cfg.provider || 'anthropic',
        name: cfg.model || 'claude-sonnet-4-6',
        mode: 'chat',
        completion_params: {
          temperature: cfg.temperature ?? 0.7,
          max_tokens: cfg.maxTokens ?? 2048,
        },
      },
      prompt_template: [
        ...(cfg.systemPrompt ? [{ role: 'system', text: cfg.systemPrompt }] : []),
        { role: 'user', text: cfg.prompt },
      ],
      context: { enabled: false, variable_selector: [] },
      vision: { enabled: false },
      variables: [],
      output_variables: [cfg.outputVariable || `${step.id}_output`],
    },
  };
}

function compileToolNode(step: WorkflowStep, pos: DifyNodePosition): DifyNode {
  const cfg = step.config as ToolStepConfig;
  const [providerHint, ...toolParts] = cfg.tool.replace(/^ref:/, '').split('.');
  const toolName = toolParts.join('.') || providerHint;

  return {
    id: step.id,
    type: 'tool',
    position: pos,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    data: {
      title: step.name || step.id,
      desc: '',
      type: 'tool',
      provider_id: providerHint,
      provider_type: cfg.tool.startsWith('builtin:') ? 'builtin' : 'api',
      tool_name: toolName,
      tool_label: toolName,
      tool_parameters: Object.fromEntries(
        Object.entries(cfg.inputs).map(([k, v]) => [
          k,
          { type: 'variable', value: v },
        ])
      ),
      output_variables: [cfg.outputVariable || `${step.id}_output`],
    },
  };
}

function compileCodeNode(step: WorkflowStep, pos: DifyNodePosition): DifyNode {
  const cfg = step.config as CodeStepConfig;
  return {
    id: step.id,
    type: 'code',
    position: pos,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    data: {
      title: step.name || step.id,
      desc: '',
      type: 'code',
      language: cfg.runtime === 'nodejs' ? 'javascript' : 'python3',
      code: cfg.code,
      variables: Object.entries(cfg.inputs).map(([k, v]) => ({
        variable: k,
        value_selector: v.replace(/^\{\{/, '').replace(/\}\}$/, '').split('.'),
      })),
      outputs: { result: { type: 'string', children: null } },
    },
  };
}

function compileKnowledgeNode(step: WorkflowStep, pos: DifyNodePosition): DifyNode {
  const cfg = step.config as KnowledgeRetrievalStepConfig;
  return {
    id: step.id,
    type: 'knowledge-retrieval',
    position: pos,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    data: {
      title: step.name || step.id,
      desc: '',
      type: 'knowledge-retrieval',
      dataset_ids: [cfg.knowledgeBase.replace(/^ref:/, '')],
      query_variable_selector: cfg.query.replace(/^\{\{/, '').replace(/\}\}$/, '').split('.'),
      retrieval_mode: 'multiple',
      multiple_retrieval_config: {
        top_k: cfg.topK ?? 4,
        score_threshold: cfg.scoreThreshold ?? 0.5,
        reranking_enable: false,
      },
      output_variables: [cfg.outputVariable || `${step.id}_output`],
    },
  };
}

function compileHITLNode(step: WorkflowStep, pos: DifyNodePosition): DifyNode {
  const cfg = step.config as HITLStepConfig;
  return {
    id: step.id,
    type: 'human-input',
    position: pos,
    width: NODE_WIDTH,
    height: NODE_HEIGHT + 40,
    data: {
      title: step.name || step.id,
      desc: 'Human-in-the-Loop approval gate',
      type: 'human-input',
      channel: cfg.channel,
      message_template: cfg.message,
      timeout_seconds: cfg.timeoutSeconds ?? 3600,
      on_timeout: cfg.onTimeout ?? 'error',
      channel_config: {
        ...(cfg.webhookUrl && { webhook_url: cfg.webhookUrl }),
        ...(cfg.slackChannel && { slack_channel: cfg.slackChannel }),
        ...(cfg.emailRecipients && { email_recipients: cfg.emailRecipients }),
      },
      output_variables: [cfg.outputVariable || `${step.id}_decision`],
    },
  };
}

function compileAgentNode(step: WorkflowStep, pos: DifyNodePosition): DifyNode {
  const cfg = step.config as AgentStepConfig;
  return {
    id: step.id,
    type: 'agent',
    position: pos,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    data: {
      title: step.name || step.id,
      desc: '',
      type: 'agent',
      agent_id: cfg.agent.replace(/^ref:/, ''),
      inputs: Object.fromEntries(
        Object.entries(cfg.inputs).map(([k, v]) => [k, { type: 'variable', value: v }])
      ),
      output_variables: [cfg.outputVariable || `${step.id}_output`],
    },
  };
}

function compileConditionNode(
  step: WorkflowStep,
  pos: DifyNodePosition,
  allNodes: DifyNode[],
  allEdges: DifyEdge[],
  xOffset: number,
  yOffset: number
): DifyNode {
  const cfg = step.config as ConditionStepConfig;

  const condNode: DifyNode = {
    id: step.id,
    type: 'if-else',
    position: pos,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    data: {
      title: step.name || step.id,
      desc: '',
      type: 'if-else',
      conditions: cfg.branches.map((b, i) => ({
        id: `${step.id}_branch_${i}`,
        logical_operator: 'and',
        conditions: [{ variable_selector: [], comparison_operator: 'custom', value: b.condition }],
      })),
    },
  };

  // Compile nested branch steps
  cfg.branches.forEach((branch, branchIdx) => {
    const branchY = yOffset + (branchIdx - (cfg.branches.length - 1) / 2) * (NODE_HEIGHT + NODE_GAP_Y) * 2;
    compileStepList(branch.steps, allNodes, allEdges, xOffset + STEP_X_STRIDE, branchY);
    if (branch.steps.length > 0) {
      allEdges.push({
        id: `${step.id}->${branch.steps[0].id}`,
        source: step.id,
        sourceHandle: `${step.id}_branch_${branchIdx}`,
        target: branch.steps[0].id,
        type: 'custom',
      });
    }
  });

  if (cfg.default && cfg.default.length > 0) {
    const defaultY = yOffset + cfg.branches.length * (NODE_HEIGHT + NODE_GAP_Y);
    compileStepList(cfg.default, allNodes, allEdges, xOffset + STEP_X_STRIDE, defaultY);
    allEdges.push({
      id: `${step.id}->default->${cfg.default[0].id}`,
      source: step.id,
      sourceHandle: `${step.id}_false`,
      target: cfg.default[0].id,
      type: 'custom',
    });
  }

  return condNode;
}

function compileIterationNode(
  step: WorkflowStep,
  pos: DifyNodePosition,
  allNodes: DifyNode[],
  allEdges: DifyEdge[],
  xOffset: number,
  yOffset: number
): DifyNode {
  const cfg = step.config as IterationStepConfig;

  const iterNode: DifyNode = {
    id: step.id,
    type: 'iteration',
    position: pos,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    data: {
      title: step.name || step.id,
      desc: '',
      type: 'iteration',
      iterator_selector: cfg.over.replace(/^\{\{/, '').replace(/\}\}$/, '').split('.'),
      item_var: cfg.itemVariable,
      is_parallel: (cfg.concurrency ?? 1) > 1,
      parallel_nums: cfg.concurrency ?? 1,
      error_handle_mode: 'terminated',
      start_node_id: cfg.steps[0]?.id || '',
    },
  };

  // Compile inner steps with indentation
  compileStepList(cfg.steps, allNodes, allEdges, xOffset + STEP_X_STRIDE, yOffset);

  return iterNode;
}

// ─────────────────────────────────────────────────────────────
// Step List Compiler
// ─────────────────────────────────────────────────────────────

function compileStepList(
  steps: WorkflowStep[],
  allNodes: DifyNode[],
  allEdges: DifyEdge[],
  xStart: number,
  yStart: number
): void {
  let prevId: string | null = null;

  steps.forEach((step, idx) => {
    const pos: DifyNodePosition = { x: xStart + idx * STEP_X_STRIDE, y: yStart };

    let node: DifyNode;
    switch (step.kind) {
      case 'llm':       node = compileLLMNode(step, pos); break;
      case 'tool':      node = compileToolNode(step, pos); break;
      case 'code':      node = compileCodeNode(step, pos); break;
      case 'knowledge': node = compileKnowledgeNode(step, pos); break;
      case 'hitl':      node = compileHITLNode(step, pos); break;
      case 'agent':     node = compileAgentNode(step, pos); break;
      case 'condition':
        node = compileConditionNode(step, pos, allNodes, allEdges, xStart + idx * STEP_X_STRIDE, yStart);
        break;
      case 'iteration':
        node = compileIterationNode(step, pos, allNodes, allEdges, xStart + idx * STEP_X_STRIDE, yStart);
        break;
      default:
        node = { id: step.id, type: 'unknown', position: pos, data: { title: step.id } };
    }

    allNodes.push(node);

    // Connect from previous step (or dependsOn if specified)
    const sources = step.dependsOn && step.dependsOn.length > 0
      ? step.dependsOn
      : prevId ? [prevId] : [];

    for (const src of sources) {
      allEdges.push({
        id: `${src}->${step.id}`,
        source: src,
        target: step.id,
        type: 'custom',
      });
    }

    prevId = step.id;
  });
}

// ─────────────────────────────────────────────────────────────
// Main Compiler
// ─────────────────────────────────────────────────────────────

/**
 * Compile a WorkflowDSL into Dify's workflow graph definition.
 */
export function compileWorkflow(dsl: WorkflowDSL): DifyWorkflowDefinition {
  const nodes: DifyNode[] = [];
  const edges: DifyEdge[] = [];

  // Start node
  const startNodeId = 'start';
  nodes.push({
    id: startNodeId,
    type: 'start',
    position: { x: 80, y: 240 },
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    data: {
      title: 'Start',
      type: 'start',
      variables: (dsl.spec.inputs || []).map((inp) => ({
        label: inp.name,
        variable: inp.name,
        type: inp.type === 'integer' ? 'number' : inp.type,
        required: inp.required ?? false,
        ...(inp.default !== undefined ? { default: inp.default } : {}),
        ...(inp.description ? { hint: inp.description } : {}),
      })),
    },
  });

  // Compile all top-level steps starting at x=80+STEP_X_STRIDE
  compileStepList(dsl.spec.steps, nodes, edges, 80 + STEP_X_STRIDE, 240);

  // Connect start → first step
  if (dsl.spec.steps.length > 0) {
    const firstStepId = dsl.spec.steps[0].id;
    edges.push({
      id: `start->${firstStepId}`,
      source: startNodeId,
      target: firstStepId,
      type: 'custom',
    });
  }

  // End node
  const endNodeId = 'end';
  const lastStep = dsl.spec.steps[dsl.spec.steps.length - 1];
  nodes.push({
    id: endNodeId,
    type: 'end',
    position: { x: 80 + (dsl.spec.steps.length + 1) * STEP_X_STRIDE, y: 240 },
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    data: {
      title: 'End',
      type: 'end',
      outputs: (dsl.spec.outputs || []).map((out) => ({
        variable: out.name,
        value_selector: out.value.replace(/^\{\{/, '').replace(/\}\}$/, '').split('.'),
      })),
    },
  });

  if (lastStep) {
    edges.push({
      id: `${lastStep.id}->${endNodeId}`,
      source: lastStep.id,
      target: endNodeId,
      type: 'custom',
    });
  }

  return {
    graph: {
      nodes,
      edges,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    features: {
      opening_statement: '',
      suggested_questions: [],
      suggested_questions_after_answer: { enabled: false },
      text_to_speech: { enabled: false },
      speech_to_text: { enabled: false },
      retriever_resource: { enabled: false },
      sensitive_word_avoidance: { enabled: false },
      file_upload: { image: { enabled: false, number_limits: 3, transfer_methods: ['remote_url', 'local_file'] } },
    },
    environment_variables: [],
    conversation_variables: [],
  };
}

/**
 * Serialize a compiled workflow to Dify's JSON import format.
 */
export function serializeWorkflow(
  dsl: WorkflowDSL,
  definition: DifyWorkflowDefinition
): string {
  const exportDoc = {
    app: {
      description: dsl.metadata.description || '',
      icon: dsl.metadata.icon || '🤖',
      icon_background: '#E5E7EB',
      mode: 'workflow',
      name: dsl.metadata.name,
      use_icon_as_answer_icon: false,
    },
    kind: 'app',
    version: '0.1.5',
    workflow: definition,
  };
  return JSON.stringify(exportDoc, null, 2);
}
