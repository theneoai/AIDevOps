/**
 * Component Registry Tests
 */

import {
  ComponentRegistry,
  RegistryEntry,
  extractWorkflowRefs,
  extractAgentRefs,
  extractOrchestrationRefs,
} from '../src/core/component-registry';
import { parseWorkflowDSL, parseAgentDSL, parseOrchestrationDSL } from '../src/core/workflow-parser';

function makeEntry(ref: string, type: RegistryEntry['type'] = 'tool_mcp'): RegistryEntry {
  return {
    ref,
    type,
    id: `uuid-${ref}`,
    name: ref,
    tenantId: 'tenant-1',
    registeredAt: new Date().toISOString(),
  };
}

describe('ComponentRegistry', () => {
  describe('register and resolve', () => {
    it('resolves a simple ref', () => {
      const reg = new ComponentRegistry();
      reg.register(makeEntry('mcp-wechat'));
      const resolved = reg.resolve('ref:mcp-wechat');
      expect(resolved?.entry.ref).toBe('mcp-wechat');
      expect(resolved?.operation).toBeUndefined();
    });

    it('resolves a compound ref with operation', () => {
      const reg = new ComponentRegistry();
      reg.register({ ...makeEntry('mcp-wechat'), operations: ['publish_article', 'upload_image'] });
      const resolved = reg.resolve('ref:mcp-wechat.publish_article');
      expect(resolved?.entry.ref).toBe('mcp-wechat');
      expect(resolved?.operation).toBe('publish_article');
    });

    it('returns null for unknown ref', () => {
      const reg = new ComponentRegistry();
      expect(reg.resolve('ref:nonexistent')).toBeNull();
    });

    it('returns null for builtin: refs (not in registry)', () => {
      const reg = new ComponentRegistry();
      expect(reg.resolve('builtin:web-search')).toBeNull();
    });

    it('returns null for unknown operation on known provider', () => {
      const reg = new ComponentRegistry();
      reg.register({ ...makeEntry('my-tool'), operations: ['known-op'] });
      expect(reg.resolve('ref:my-tool.unknown-op')).toBeNull();
    });
  });

  describe('has', () => {
    it('returns true for registered refs', () => {
      const reg = new ComponentRegistry();
      reg.register(makeEntry('my-agent', 'agent'));
      expect(reg.has('ref:my-agent')).toBe(true);
    });

    it('returns false for unregistered refs', () => {
      const reg = new ComponentRegistry();
      expect(reg.has('ref:ghost')).toBe(false);
    });
  });

  describe('list', () => {
    it('lists all entries', () => {
      const reg = new ComponentRegistry();
      reg.register(makeEntry('tool-a', 'tool_api'));
      reg.register(makeEntry('agent-b', 'agent'));
      reg.register(makeEntry('wf-c', 'workflow'));
      expect(reg.list()).toHaveLength(3);
    });

    it('filters by type', () => {
      const reg = new ComponentRegistry();
      reg.register(makeEntry('tool-a', 'tool_api'));
      reg.register(makeEntry('agent-b', 'agent'));
      expect(reg.list('tool_api')).toHaveLength(1);
      expect(reg.list('agent')).toHaveLength(1);
    });
  });

  describe('validateRefs', () => {
    it('returns empty array when all refs are registered', () => {
      const reg = new ComponentRegistry();
      reg.register(makeEntry('mcp-wechat'));
      reg.register(makeEntry('my-kb', 'knowledge'));
      const unresolved = reg.validateRefs(['ref:mcp-wechat', 'ref:my-kb', 'builtin:http']);
      expect(unresolved).toHaveLength(0);
    });

    it('returns unresolved refs', () => {
      const reg = new ComponentRegistry();
      reg.register(makeEntry('known'));
      const unresolved = reg.validateRefs(['ref:known', 'ref:unknown-a', 'ref:unknown-b']);
      expect(unresolved).toContain('ref:unknown-a');
      expect(unresolved).toContain('ref:unknown-b');
      expect(unresolved).not.toContain('ref:known');
    });
  });

  describe('hydrate and stats', () => {
    it('hydrates from array', () => {
      const reg = new ComponentRegistry();
      reg.hydrate([
        makeEntry('a', 'tool_api'),
        makeEntry('b', 'agent'),
        makeEntry('c', 'workflow'),
      ]);
      const stats = reg.stats();
      expect(stats.total).toBe(3);
      expect(stats.tool_api).toBe(1);
      expect(stats.agent).toBe(1);
      expect(stats.workflow).toBe(1);
    });
  });
});

describe('extractWorkflowRefs', () => {
  it('extracts tool and agent refs from workflow', () => {
    const dsl = parseWorkflowDSL(`
apiVersion: dify.dev/v1
kind: Workflow
metadata:
  name: test
spec:
  steps:
    - id: s1
      kind: tool
      config:
        tool: ref:mcp-wechat.publish_article
        inputs: {}
    - id: s2
      kind: agent
      config:
        agent: ref:content-writer
        inputs: {}
    - id: s3
      kind: knowledge
      config:
        knowledgeBase: ref:my-kb
        query: "{{inputs.q}}"
`);
    const refs = extractWorkflowRefs(dsl);
    expect(refs).toContain('ref:mcp-wechat.publish_article');
    expect(refs).toContain('ref:content-writer');
    expect(refs).toContain('ref:my-kb');
  });

  it('extracts refs from nested condition branches', () => {
    const dsl = parseWorkflowDSL(`
apiVersion: dify.dev/v1
kind: Workflow
metadata:
  name: nested
spec:
  steps:
    - id: branch
      kind: condition
      config:
        branches:
          - condition: "{{x}} == true"
            steps:
              - id: inner_tool
                kind: tool
                config:
                  tool: ref:inner-provider.op
                  inputs: {}
`);
    const refs = extractWorkflowRefs(dsl);
    expect(refs).toContain('ref:inner-provider.op');
  });
});

describe('extractAgentRefs', () => {
  it('extracts tool refs from agent spec', () => {
    const dsl = parseAgentDSL(`
apiVersion: dify.dev/v1
kind: Agent
metadata:
  name: my-agent
spec:
  systemPrompt: You are helpful.
  tools:
    - ref: ref:mcp-wechat.publish_article
    - ref: builtin:web-search
`);
    const refs = extractAgentRefs(dsl);
    expect(refs).toContain('ref:mcp-wechat.publish_article');
    expect(refs).toContain('builtin:web-search');
  });
});

describe('extractOrchestrationRefs', () => {
  it('extracts agent refs from orchestration', () => {
    const dsl = parseOrchestrationDSL(`
apiVersion: dify.dev/v1
kind: Orchestration
metadata:
  name: team
spec:
  strategy: sequential
  agents:
    - ref: ref:supervisor-agent
      role: supervisor
    - ref: ref:worker-agent
      role: worker
`);
    const refs = extractOrchestrationRefs(dsl);
    expect(refs).toContain('ref:supervisor-agent');
    expect(refs).toContain('ref:worker-agent');
  });
});
