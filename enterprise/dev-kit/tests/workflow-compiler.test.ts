/**
 * Workflow Compiler Tests
 */

import { compileWorkflow, serializeWorkflow, DifyWorkflowDefinition } from '../src/core/workflow-compiler';
import { parseWorkflowDSL } from '../src/core/workflow-parser';

function makeWorkflow(stepsYaml: string) {
  // Indent all lines of stepsYaml by 2 spaces so they nest under spec:
  const indented = stepsYaml
    .split('\n')
    .map(line => (line.trim() === '' ? '' : `  ${line}`))
    .join('\n');
  return parseWorkflowDSL(
    `apiVersion: dify.dev/v1\nkind: Workflow\nmetadata:\n  name: test-workflow\n  version: 1.0.0\nspec:\n${indented}\n`
  );
}

describe('compileWorkflow', () => {
  it('produces start and end nodes for any workflow', () => {
    const dsl = makeWorkflow(`
steps:
  - id: step1
    kind: llm
    config:
      prompt: hello
`);
    const def = compileWorkflow(dsl);
    const nodeIds = def.graph.nodes.map(n => n.id);
    expect(nodeIds).toContain('start');
    expect(nodeIds).toContain('end');
    expect(nodeIds).toContain('step1');
  });

  it('connects start → first step → end', () => {
    const dsl = makeWorkflow(`
steps:
  - id: first_step
    kind: llm
    config:
      prompt: hello
`);
    const def = compileWorkflow(dsl);
    const edgePairs = def.graph.edges.map(e => `${e.source}->${e.target}`);
    expect(edgePairs).toContain('start->first_step');
    expect(edgePairs).toContain('first_step->end');
  });

  it('chains sequential steps with edges', () => {
    const dsl = makeWorkflow(`
steps:
  - id: s1
    kind: llm
    config:
      prompt: step 1
  - id: s2
    kind: tool
    config:
      tool: ref:my-tool.op
      inputs: {}
  - id: s3
    kind: code
    config:
      runtime: python3
      code: "return inputs['x']"
      inputs:
        x: "{{steps.s2.output}}"
`);
    const def = compileWorkflow(dsl);
    const edgePairs = def.graph.edges.map(e => `${e.source}->${e.target}`);
    expect(edgePairs).toContain('s1->s2');
    expect(edgePairs).toContain('s2->s3');
  });

  it('respects dependsOn for non-linear ordering', () => {
    const dsl = makeWorkflow(`
steps:
  - id: a
    kind: llm
    config:
      prompt: a
  - id: b
    kind: llm
    config:
      prompt: b
  - id: c
    kind: llm
    dependsOn: [a, b]
    config:
      prompt: c
`);
    const def = compileWorkflow(dsl);
    const edgePairs = def.graph.edges.map(e => `${e.source}->${e.target}`);
    expect(edgePairs).toContain('a->c');
    expect(edgePairs).toContain('b->c');
  });

  it('compiles LLM node with correct model config', () => {
    const dsl = makeWorkflow(`
steps:
  - id: gen
    kind: llm
    config:
      provider: anthropic
      model: claude-sonnet-4-6
      systemPrompt: You are helpful.
      prompt: "{{inputs.question}}"
      temperature: 0.5
      maxTokens: 1024
`);
    const def = compileWorkflow(dsl);
    const node = def.graph.nodes.find(n => n.id === 'gen');
    expect(node?.type).toBe('llm');
    expect((node?.data as Record<string, unknown>).model).toMatchObject({
      provider: 'anthropic',
      name: 'claude-sonnet-4-6',
    });
  });

  it('compiles tool node with provider and tool name', () => {
    const dsl = makeWorkflow(`
steps:
  - id: pub
    kind: tool
    config:
      tool: ref:mcp-wechat.publish_article
      inputs:
        title: "{{inputs.title}}"
`);
    const def = compileWorkflow(dsl);
    const node = def.graph.nodes.find(n => n.id === 'pub');
    expect(node?.type).toBe('tool');
    const data = node?.data as Record<string, unknown>;
    expect(data.provider_id).toBe('mcp-wechat');
    expect(data.tool_name).toBe('publish_article');
  });

  it('compiles HITL node with approval config', () => {
    const dsl = makeWorkflow(`
steps:
  - id: approve
    kind: hitl
    config:
      channel: slack
      slackChannel: "#reviews"
      message: "Please review"
      timeoutSeconds: 3600
      onTimeout: reject
`);
    const def = compileWorkflow(dsl);
    const node = def.graph.nodes.find(n => n.id === 'approve');
    expect(node?.type).toBe('human-input');
    const data = node?.data as Record<string, unknown>;
    expect(data.channel).toBe('slack');
    expect(data.timeout_seconds).toBe(3600);
    expect(data.on_timeout).toBe('reject');
  });

  it('compiles knowledge retrieval node', () => {
    const dsl = makeWorkflow(`
steps:
  - id: search
    kind: knowledge
    config:
      knowledgeBase: ref:my-kb
      query: "{{inputs.question}}"
      topK: 5
`);
    const def = compileWorkflow(dsl);
    const node = def.graph.nodes.find(n => n.id === 'search');
    expect(node?.type).toBe('knowledge-retrieval');
    const data = node?.data as Record<string, unknown>;
    expect(data.dataset_ids).toContain('my-kb');
  });

  it('emits inputs on start node', () => {
    const dsl = parseWorkflowDSL(`
apiVersion: dify.dev/v1
kind: Workflow
metadata:
  name: io-test
spec:
  inputs:
    - name: question
      type: string
      required: true
  steps:
    - id: s1
      kind: llm
      config:
        prompt: "{{inputs.question}}"
`);
    const def = compileWorkflow(dsl);
    const startNode = def.graph.nodes.find(n => n.id === 'start');
    const vars = (startNode?.data as Record<string, unknown>).variables as Array<Record<string, unknown>>;
    expect(vars.some(v => v.variable === 'question')).toBe(true);
  });

  it('emits outputs on end node', () => {
    const dsl = parseWorkflowDSL(`
apiVersion: dify.dev/v1
kind: Workflow
metadata:
  name: io-test
spec:
  outputs:
    - name: answer
      type: string
      value: "{{steps.s1.output}}"
  steps:
    - id: s1
      kind: llm
      config:
        prompt: hi
`);
    const def = compileWorkflow(dsl);
    const endNode = def.graph.nodes.find(n => n.id === 'end');
    const outputs = (endNode?.data as Record<string, unknown>).outputs as Array<Record<string, unknown>>;
    expect(outputs.some(o => o.variable === 'answer')).toBe(true);
  });

  it('includes graph metadata in definition', () => {
    const dsl = makeWorkflow(`
steps:
  - id: s
    kind: llm
    config:
      prompt: x
`);
    const def = compileWorkflow(dsl);
    expect(def.graph.viewport).toBeDefined();
    expect(def.features).toBeDefined();
    expect(def.environment_variables).toEqual([]);
  });
});

describe('serializeWorkflow', () => {
  it('produces valid JSON with app and workflow keys', () => {
    const dsl = makeWorkflow(`
steps:
  - id: s
    kind: llm
    config:
      prompt: hi
`);
    const def = compileWorkflow(dsl);
    const json = serializeWorkflow(dsl, def);
    const parsed = JSON.parse(json);

    expect(parsed.app.name).toBe('test-workflow');
    expect(parsed.app.mode).toBe('workflow');
    expect(parsed.kind).toBe('app');
    expect(parsed.workflow).toBeDefined();
  });
});
