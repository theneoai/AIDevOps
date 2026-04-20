/**
 * P5-3a: Workflow DSL Compiler
 *
 * Translates the DevKit WorkflowDSL (YAML) into a Dify Workflow JSON
 * ready to POST to /v1/workspaces/current/workflows.
 */

import { WorkflowDSL, WorkflowStep, LLMStepConfig, ToolStepConfig, ConditionStepConfig, HITLStepConfig, WorkflowInput, WorkflowOutput } from '../types/dsl';
import { buildLLMNode } from './node-builders/llm-node';
import { buildToolNode } from './node-builders/tool-node';
import { buildConditionNode } from './node-builders/condition-node';
import { buildHITLNode } from './node-builders/human-in-loop-node';

// ─────────────────────────────────────────────────────────────
// Dify Workflow Graph Types
// ─────────────────────────────────────────────────────────────

export interface DifyNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface DifyEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface DifyWorkflowGraph {
  nodes: DifyNode[];
  edges: DifyEdge[];
  viewport?: { x: number; y: number; zoom: number };
}

export interface DifyWorkflowPayload {
  name: string;
  description: string;
  mode: 'workflow';
  graph: DifyWorkflowGraph;
  features: {
    file_upload: { enabled: boolean };
    opening_statement: string;
    text_to_speech: { enabled: boolean };
    speech_to_text: { enabled: boolean };
    citation: { enabled: boolean };
  };
}

// ─────────────────────────────────────────────────────────────
// Compiler
// ─────────────────────────────────────────────────────────────

const GRID_X = 320;
const GRID_Y = 150;

export class WorkflowCompiler {
  // Map of tool ref → resolved Dify provider UUID. Populated via resolveToolRefs().
  private toolRefMap: Map<string, string> = new Map();

  setToolRefMap(map: Map<string, string>): void {
    this.toolRefMap = map;
  }

  compile(dsl: WorkflowDSL): DifyWorkflowPayload {
    const nodes: DifyNode[] = [];
    const edges: DifyEdge[] = [];

    // Start node
    nodes.push(this.buildStartNode(dsl.spec.inputs ?? [], { x: 0, y: 0 }));

    // Compile each step
    dsl.spec.steps.forEach((step, i) => {
      const position = { x: GRID_X * (i + 1), y: 0 };
      const node = this.compileStep(step, position);
      nodes.push(node);

      // Build edges from dependencies or previous step
      const sources = step.dependsOn?.length
        ? step.dependsOn
        : i === 0
        ? ['start']
        : [dsl.spec.steps[i - 1].id];

      for (const src of sources) {
        edges.push({
          id: `${src}->${step.id}`,
          source: src,
          target: step.id,
        });
      }
    });

    // End node
    const lastStep = dsl.spec.steps[dsl.spec.steps.length - 1];
    const endX = GRID_X * (dsl.spec.steps.length + 1);
    nodes.push(this.buildEndNode(dsl.spec.outputs ?? [], { x: endX, y: 0 }));
    edges.push({ id: `${lastStep.id}->end`, source: lastStep.id, target: 'end' });

    return {
      name: dsl.metadata.name,
      description: dsl.metadata.description ?? '',
      mode: 'workflow',
      graph: { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } },
      features: {
        file_upload: { enabled: false },
        opening_statement: '',
        text_to_speech: { enabled: false },
        speech_to_text: { enabled: false },
        citation: { enabled: false },
      },
    };
  }

  private compileStep(step: WorkflowStep, position: { x: number; y: number }): DifyNode {
    const name = step.name ?? step.id;
    switch (step.kind) {
      case 'llm':
        return buildLLMNode(step.id, name, step.config as LLMStepConfig, position) as DifyNode;

      case 'tool': {
        const tc = step.config as ToolStepConfig;
        const providerId = this.toolRefMap.get(tc.tool) ?? tc.tool;
        return buildToolNode(step.id, name, tc, position, providerId) as DifyNode;
      }

      case 'condition':
        return buildConditionNode(step.id, name, step.config as ConditionStepConfig, position) as DifyNode;

      case 'hitl':
        return buildHITLNode(step.id, name, step.config as HITLStepConfig, position) as DifyNode;

      case 'code':
        return {
          id: step.id,
          type: 'code',
          data: { title: name, ...step.config },
          position,
        };

      case 'knowledge':
        return {
          id: step.id,
          type: 'knowledge-retrieval',
          data: { title: name, ...step.config },
          position,
        };

      case 'iteration':
        return {
          id: step.id,
          type: 'iteration',
          data: { title: name, ...step.config },
          position,
        };

      case 'agent':
        return {
          id: step.id,
          type: 'agent',
          data: { title: name, ...step.config },
          position,
        };

      default:
        throw new Error(`Unknown step kind: ${(step as WorkflowStep).kind}`);
    }
  }

  private buildStartNode(
    inputs: WorkflowInput[],
    position: { x: number; y: number },
  ): DifyNode {
    return {
      id: 'start',
      type: 'start',
      data: {
        title: 'Start',
        variables: inputs.map((inp) => ({
          variable: inp.name,
          label: inp.name,
          type: inp.type,
          required: inp.required ?? false,
          default: inp.default ?? '',
          options: [],
          max_length: 256,
        })),
      },
      position,
    };
  }

  private buildEndNode(
    outputs: WorkflowOutput[],
    position: { x: number; y: number },
  ): DifyNode {
    return {
      id: 'end',
      type: 'end',
      data: {
        title: 'End',
        outputs: outputs.map((o) => ({
          variable: o.name,
          value_selector: o.value.replace(/^\{\{|\}\}$/g, '').trim(),
        })),
      },
      position,
    };
  }
}

export function compileWorkflow(dsl: WorkflowDSL, toolRefMap?: Map<string, string>): DifyWorkflowPayload {
  const compiler = new WorkflowCompiler();
  if (toolRefMap) compiler.setToolRefMap(toolRefMap);
  return compiler.compile(dsl);
}
