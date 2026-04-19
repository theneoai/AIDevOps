/**
 * Workflow, Agent, Orchestration DSL Parser Tests
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  parseWorkflowDSL,
  parseWorkflowDSLFromFile,
  parseAgentDSL,
  parseOrchestrationDSL,
  parseChatflowDSL,
  validateWorkflowSemantics,
  ParseError,
} from '../src/core/workflow-parser';

const FIXTURES = path.join(__dirname, 'fixtures');

// ─────────────────────────────────────────────────────────────
// Workflow Parser Tests
// ─────────────────────────────────────────────────────────────

describe('parseWorkflowDSL', () => {
  it('parses a minimal valid workflow', () => {
    const yaml = `
apiVersion: dify.dev/v1
kind: Workflow
metadata:
  name: test-workflow
spec:
  steps:
    - id: step1
      kind: llm
      config:
        prompt: "Hello {{inputs.name}}"
`;
    const dsl = parseWorkflowDSL(yaml);
    expect(dsl.kind).toBe('Workflow');
    expect(dsl.metadata.name).toBe('test-workflow');
    expect(dsl.spec.steps).toHaveLength(1);
    expect(dsl.spec.steps[0].id).toBe('step1');
    expect(dsl.spec.steps[0].kind).toBe('llm');
  });

  it('parses inputs and outputs', () => {
    const yaml = `
apiVersion: dify.dev/v1
kind: Workflow
metadata:
  name: io-workflow
spec:
  inputs:
    - name: topic
      type: string
      required: true
  outputs:
    - name: result
      type: string
      value: "{{steps.llm.output}}"
  steps:
    - id: llm
      kind: llm
      config:
        prompt: "Write about {{inputs.topic}}"
`;
    const dsl = parseWorkflowDSL(yaml);
    expect(dsl.spec.inputs).toHaveLength(1);
    expect(dsl.spec.inputs![0].name).toBe('topic');
    expect(dsl.spec.inputs![0].required).toBe(true);
    expect(dsl.spec.outputs).toHaveLength(1);
    expect(dsl.spec.outputs![0].value).toBe('{{steps.llm.output}}');
  });

  it('parses a tool step with inputs mapping', () => {
    const yaml = `
apiVersion: dify.dev/v1
kind: Workflow
metadata:
  name: tool-workflow
spec:
  steps:
    - id: publish
      kind: tool
      config:
        tool: ref:mcp-wechat.publish_article
        inputs:
          title: "{{inputs.title}}"
          content: "{{steps.llm.output}}"
`;
    const dsl = parseWorkflowDSL(yaml);
    const step = dsl.spec.steps[0];
    expect(step.kind).toBe('tool');
    const cfg = step.config as { tool: string; inputs: Record<string, string> };
    expect(cfg.tool).toBe('ref:mcp-wechat.publish_article');
    expect(cfg.inputs.title).toBe('{{inputs.title}}');
  });

  it('parses HITL step', () => {
    const yaml = `
apiVersion: dify.dev/v1
kind: Workflow
metadata:
  name: hitl-workflow
spec:
  steps:
    - id: approve
      kind: hitl
      config:
        channel: slack
        slackChannel: "#approvals"
        message: "Please review: {{steps.llm.output}}"
        timeoutSeconds: 3600
        onTimeout: reject
`;
    const dsl = parseWorkflowDSL(yaml);
    const step = dsl.spec.steps[0];
    expect(step.kind).toBe('hitl');
    const cfg = step.config as { channel: string; timeoutSeconds: number; onTimeout: string };
    expect(cfg.channel).toBe('slack');
    expect(cfg.timeoutSeconds).toBe(3600);
    expect(cfg.onTimeout).toBe('reject');
  });

  it('parses iteration step with nested steps', () => {
    const yaml = `
apiVersion: dify.dev/v1
kind: Workflow
metadata:
  name: iter-workflow
spec:
  steps:
    - id: process_items
      kind: iteration
      config:
        over: "{{inputs.items}}"
        itemVariable: item
        concurrency: 3
        steps:
          - id: transform
            kind: llm
            config:
              prompt: "Transform: {{item}}"
`;
    const dsl = parseWorkflowDSL(yaml);
    const step = dsl.spec.steps[0];
    expect(step.kind).toBe('iteration');
    const cfg = step.config as { over: string; itemVariable: string; concurrency: number; steps: unknown[] };
    expect(cfg.over).toBe('{{inputs.items}}');
    expect(cfg.itemVariable).toBe('item');
    expect(cfg.concurrency).toBe(3);
    expect(cfg.steps).toHaveLength(1);
  });

  it('parses code step', () => {
    const yaml = `
apiVersion: dify.dev/v1
kind: Workflow
metadata:
  name: code-workflow
spec:
  steps:
    - id: transform
      kind: code
      config:
        runtime: python3
        code: |
          result = inputs['text'].upper()
          return result
        inputs:
          text: "{{inputs.raw_text}}"
`;
    const dsl = parseWorkflowDSL(yaml);
    const cfg = dsl.spec.steps[0].config as { runtime: string; code: string };
    expect(cfg.runtime).toBe('python3');
    expect(cfg.code).toContain('upper()');
  });

  it('parses sample-workflow.yml fixture', () => {
    const dsl = parseWorkflowDSLFromFile(path.join(FIXTURES, 'sample-workflow.yml'));
    expect(dsl.kind).toBe('Workflow');
    expect(dsl.metadata.name).toBe('marketing-content-pipeline');
    expect(dsl.spec.steps.length).toBeGreaterThan(3);
    const stepKinds = dsl.spec.steps.map(s => s.kind);
    expect(stepKinds).toContain('llm');
    expect(stepKinds).toContain('tool');
    expect(stepKinds).toContain('hitl');
    expect(stepKinds).toContain('knowledge');
  });

  it('throws ParseError for missing required fields', () => {
    const yaml = `
apiVersion: dify.dev/v1
kind: Workflow
metadata:
  name: bad-workflow
spec:
  steps: []
`;
    expect(() => parseWorkflowDSL(yaml)).toThrow(ParseError);
  });

  it('throws ParseError for invalid step kind', () => {
    const yaml = `
apiVersion: dify.dev/v1
kind: Workflow
metadata:
  name: bad-workflow
spec:
  steps:
    - id: s1
      kind: invalid_kind
      config:
        prompt: test
`;
    expect(() => parseWorkflowDSL(yaml)).toThrow(ParseError);
  });

  it('throws ParseError for invalid step id (starts with number)', () => {
    const yaml = `
apiVersion: dify.dev/v1
kind: Workflow
metadata:
  name: bad-workflow
spec:
  steps:
    - id: 1bad_id
      kind: llm
      config:
        prompt: test
`;
    expect(() => parseWorkflowDSL(yaml)).toThrow(ParseError);
  });
});

// ─────────────────────────────────────────────────────────────
// Semantic Validation Tests
// ─────────────────────────────────────────────────────────────

describe('validateWorkflowSemantics', () => {
  it('passes for a valid workflow', () => {
    const dsl = parseWorkflowDSL(`
apiVersion: dify.dev/v1
kind: Workflow
metadata:
  name: valid
spec:
  steps:
    - id: step_a
      kind: llm
      config:
        prompt: hello
    - id: step_b
      kind: tool
      dependsOn: [step_a]
      config:
        tool: ref:my-tool.op
        inputs: {}
`);
    const result = validateWorkflowSemantics(dsl);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects duplicate step ids', () => {
    const dsl = parseWorkflowDSL(`
apiVersion: dify.dev/v1
kind: Workflow
metadata:
  name: dup
spec:
  steps:
    - id: step_a
      kind: llm
      config:
        prompt: hello
    - id: step_a
      kind: llm
      config:
        prompt: world
`);
    const result = validateWorkflowSemantics(dsl);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('Duplicate'))).toBe(true);
  });

  it('warns on literal output values (not variable references)', () => {
    const dsl = parseWorkflowDSL(`
apiVersion: dify.dev/v1
kind: Workflow
metadata:
  name: warn
spec:
  outputs:
    - name: out
      type: string
      value: literal_not_ref
  steps:
    - id: s
      kind: llm
      config:
        prompt: test
`);
    const result = validateWorkflowSemantics(dsl);
    expect(result.warnings.some(w => w.message.includes('literal'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Agent DSL Parser Tests
// ─────────────────────────────────────────────────────────────

describe('parseAgentDSL', () => {
  it('parses a minimal agent', () => {
    const yaml = `
apiVersion: dify.dev/v1
kind: Agent
metadata:
  name: my-agent
spec:
  systemPrompt: You are a helpful assistant.
`;
    const dsl = parseAgentDSL(yaml);
    expect(dsl.kind).toBe('Agent');
    expect(dsl.spec.systemPrompt).toBe('You are a helpful assistant.');
  });

  it('parses tools, memory, and guardrails', () => {
    const yaml = `
apiVersion: dify.dev/v1
kind: Agent
metadata:
  name: full-agent
spec:
  systemPrompt: You are an expert researcher.
  tools:
    - ref: ref:mcp-wechat.publish_article
      name: Publish WeChat Article
  memory:
    type: conversation
    windowSize: 10
  guardrails:
    - type: content_filter
      applies: both
    - type: length_limit
      applies: output
      maxTokens: 4096
  maxIterations: 15
`;
    const dsl = parseAgentDSL(yaml);
    expect(dsl.spec.tools).toHaveLength(1);
    expect(dsl.spec.memory?.type).toBe('conversation');
    expect(dsl.spec.memory?.windowSize).toBe(10);
    expect(dsl.spec.guardrails).toHaveLength(2);
    expect(dsl.spec.maxIterations).toBe(15);
  });

  it('throws ParseError when systemPrompt is missing', () => {
    const yaml = `
apiVersion: dify.dev/v1
kind: Agent
metadata:
  name: bad-agent
spec:
  maxIterations: 5
`;
    expect(() => parseAgentDSL(yaml)).toThrow(ParseError);
  });
});

// ─────────────────────────────────────────────────────────────
// Orchestration DSL Parser Tests
// ─────────────────────────────────────────────────────────────

describe('parseOrchestrationDSL', () => {
  it('parses a supervisor orchestration', () => {
    const dsl = parseOrchestrationDSL(`
apiVersion: dify.dev/v1
kind: Orchestration
metadata:
  name: research-team
spec:
  strategy: supervisor
  supervisor: ref:supervisor-agent
  agents:
    - ref: ref:supervisor-agent
      role: supervisor
    - ref: ref:worker-agent
      role: worker
  maxRounds: 5
`);
    expect(dsl.kind).toBe('Orchestration');
    expect(dsl.spec.strategy).toBe('supervisor');
    expect(dsl.spec.supervisor).toBe('ref:supervisor-agent');
    expect(dsl.spec.agents).toHaveLength(2);
    expect(dsl.spec.maxRounds).toBe(5);
  });

  it('parses sample-orchestration.yml fixture', () => {
    const dsl = parseOrchestrationDSL(
      fs.readFileSync(path.join(FIXTURES, 'sample-orchestration.yml'), 'utf-8')
    );
    expect(dsl.metadata.name).toBe('content-research-team');
    expect(dsl.spec.agents.length).toBeGreaterThan(2);
    expect(dsl.spec.strategy).toBe('supervisor');
  });

  it('throws ParseError when supervisor strategy lacks supervisor field', () => {
    const yaml = `
apiVersion: dify.dev/v1
kind: Orchestration
metadata:
  name: bad-orch
spec:
  strategy: supervisor
  agents:
    - ref: ref:a1
      role: supervisor
    - ref: ref:a2
      role: worker
`;
    expect(() => parseOrchestrationDSL(yaml)).toThrow(ParseError);
  });

  it('throws ParseError when fewer than 2 agents', () => {
    const yaml = `
apiVersion: dify.dev/v1
kind: Orchestration
metadata:
  name: solo
spec:
  strategy: sequential
  agents:
    - ref: ref:only-one
      role: worker
`;
    expect(() => parseOrchestrationDSL(yaml)).toThrow(ParseError);
  });

  it('parses parallel strategy', () => {
    const dsl = parseOrchestrationDSL(`
apiVersion: dify.dev/v1
kind: Orchestration
metadata:
  name: parallel-team
spec:
  strategy: parallel
  outputFormat: aggregated
  agents:
    - ref: ref:analyst-a
      role: worker
    - ref: ref:analyst-b
      role: worker
    - ref: ref:analyst-c
      role: worker
`);
    expect(dsl.spec.strategy).toBe('parallel');
    expect(dsl.spec.outputFormat).toBe('aggregated');
    expect(dsl.spec.agents).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────
// Chatflow DSL Parser Tests
// ─────────────────────────────────────────────────────────────

describe('parseChatflowDSL', () => {
  it('parses a minimal chatflow', () => {
    const dsl = parseChatflowDSL(`
apiVersion: dify.dev/v1
kind: Chatflow
metadata:
  name: customer-support
spec:
  systemPrompt: You are a helpful customer support assistant.
  openingStatement: Hi! How can I help you today?
`);
    expect(dsl.kind).toBe('Chatflow');
    expect(dsl.spec.openingStatement).toBe('Hi! How can I help you today?');
  });
});
