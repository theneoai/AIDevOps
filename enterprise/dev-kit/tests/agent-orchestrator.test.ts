/**
 * Multi-Agent Orchestrator Tests
 */

import {
  AgentOrchestrator,
  mockExecutor,
  AgentContext,
  OrchestrationEvent,
} from '../src/core/agent-orchestrator';
import { parseOrchestrationDSL } from '../src/core/workflow-parser';

function makeOrchestration(strategy: string, extra = '') {
  return parseOrchestrationDSL(`
apiVersion: dify.dev/v1
kind: Orchestration
metadata:
  name: test-team
spec:
  strategy: ${strategy}
  ${strategy === 'supervisor' ? 'supervisor: ref:supervisor' : ''}
  agents:
    - ref: ref:supervisor
      role: supervisor
    - ref: ref:worker-a
      role: worker
    - ref: ref:worker-b
      role: worker
  maxRounds: 4
  ${extra}
`);
}

// ─────────────────────────────────────────────────────────────
// Sequential Strategy
// ─────────────────────────────────────────────────────────────

describe('AgentOrchestrator – sequential', () => {
  it('runs all agents in order and collects outputs', async () => {
    const dsl = makeOrchestration('sequential');
    const orchestrator = new AgentOrchestrator(dsl);
    const callOrder: string[] = [];

    const result = await orchestrator.run('test task', {
      executors: {
        'ref:supervisor': async (id, ctx) => { callOrder.push(id); return 'supervisor-out'; },
        'ref:worker-a':   async (id, ctx) => { callOrder.push(id); return 'worker-a-out'; },
        'ref:worker-b':   async (id, ctx) => { callOrder.push(id); return 'worker-b-out'; },
      },
    });

    expect(callOrder).toEqual(['ref:supervisor', 'ref:worker-a', 'ref:worker-b']);
    expect(result.rounds).toBe(1);
    expect(result.result).toBe('worker-b-out');
    expect(result.sharedState['ref:worker-a_output']).toBe('worker-a-out');
  });

  it('passes accumulated messages as context to later agents', async () => {
    const dsl = makeOrchestration('sequential');
    const orchestrator = new AgentOrchestrator(dsl);
    let workerBCtxMessages: string[] = [];

    await orchestrator.run('task', {
      executors: {
        'ref:supervisor': async () => 'supervisor said something',
        'ref:worker-a':   async () => 'worker-a said something',
        'ref:worker-b':   async (id, ctx) => {
          workerBCtxMessages = ctx.messages.map(m => m.content);
          return 'done';
        },
      },
    });

    expect(workerBCtxMessages).toContain('supervisor said something');
    expect(workerBCtxMessages).toContain('worker-a said something');
  });
});

// ─────────────────────────────────────────────────────────────
// Parallel Strategy
// ─────────────────────────────────────────────────────────────

describe('AgentOrchestrator – parallel', () => {
  it('runs all agents concurrently and aggregates outputs', async () => {
    const dsl = makeOrchestration('parallel');
    const orchestrator = new AgentOrchestrator(dsl);
    const startTimes: number[] = [];

    await orchestrator.run('task', {
      executors: {
        'ref:supervisor': async () => { startTimes.push(Date.now()); await delay(30); return 'out-s'; },
        'ref:worker-a':   async () => { startTimes.push(Date.now()); await delay(30); return 'out-a'; },
        'ref:worker-b':   async () => { startTimes.push(Date.now()); await delay(30); return 'out-b'; },
      },
    });

    // All agents should have started within ~50ms of each other (parallel)
    const spread = Math.max(...startTimes) - Math.min(...startTimes);
    expect(spread).toBeLessThan(50);
  });

  it('includes all agent outputs in aggregated result', async () => {
    const dsl = makeOrchestration('parallel');
    const orchestrator = new AgentOrchestrator(dsl);

    const result = await orchestrator.run('task', {
      executors: {
        'ref:supervisor': mockExecutor(['Supervisor output']),
        'ref:worker-a':   mockExecutor(['Worker A output']),
        'ref:worker-b':   mockExecutor(['Worker B output']),
      },
    });

    expect(result.result).toContain('Supervisor output');
    expect(result.result).toContain('Worker A output');
    expect(result.result).toContain('Worker B output');
  });
});

// ─────────────────────────────────────────────────────────────
// Supervisor Strategy
// ─────────────────────────────────────────────────────────────

describe('AgentOrchestrator – supervisor', () => {
  it('supervisor can finish immediately', async () => {
    const dsl = makeOrchestration('supervisor');
    const orchestrator = new AgentOrchestrator(dsl);

    const result = await orchestrator.run('task', {
      executors: {
        'ref:supervisor': mockExecutor(['FINISH: Here is the final answer']),
        'ref:worker-a':   mockExecutor(['worker a response']),
        'ref:worker-b':   mockExecutor(['worker b response']),
      },
    });

    expect(result.result).toBe('Here is the final answer');
    expect(result.rounds).toBe(1);
  });

  it('supervisor routes to workers then finishes', async () => {
    const dsl = makeOrchestration('supervisor');
    const orchestrator = new AgentOrchestrator(dsl);
    const workerACalls: number[] = [];

    const result = await orchestrator.run('task', {
      maxRounds: 4,
      executors: {
        'ref:supervisor': mockExecutor([
          'ROUTE: ref:worker-a\nPlease research this',
          'FINISH: Based on research, here is the result',
        ]),
        'ref:worker-a': async () => { workerACalls.push(Date.now()); return 'research findings'; },
        'ref:worker-b': mockExecutor(['worker b response']),
      },
    });

    expect(workerACalls.length).toBeGreaterThan(0);
    expect(result.result).toBe('Based on research, here is the result');
  });

  it('stops after maxRounds if supervisor never finishes', async () => {
    const dsl = makeOrchestration('supervisor');
    const orchestrator = new AgentOrchestrator(dsl);

    const result = await orchestrator.run('task', {
      maxRounds: 3,
      executors: {
        'ref:supervisor': mockExecutor(['ROUTE: ref:worker-a\nkeep going']),
        'ref:worker-a':   mockExecutor(['still working']),
        'ref:worker-b':   mockExecutor(['still working']),
      },
    });

    expect(result.rounds).toBe(3);
    // After maxRounds the orchestration terminates even without FINISH signal
  });
});

// ─────────────────────────────────────────────────────────────
// Event Bus
// ─────────────────────────────────────────────────────────────

describe('AgentOrchestrator – event bus', () => {
  it('emits agent_start and agent_output events', async () => {
    const dsl = makeOrchestration('sequential');
    const orchestrator = new AgentOrchestrator(dsl);
    const events: OrchestrationEvent[] = [];

    orchestrator.events.on('orchestration', (e) => events.push(e));

    await orchestrator.run('task', {
      executors: {
        'ref:supervisor': mockExecutor(['s out']),
        'ref:worker-a':   mockExecutor(['a out']),
        'ref:worker-b':   mockExecutor(['b out']),
      },
    });

    const startEvents = events.filter(e => e.type === 'agent_start');
    const outputEvents = events.filter(e => e.type === 'agent_output');
    expect(startEvents.length).toBe(3);
    expect(outputEvents.length).toBe(3);
  });

  it('emits done event with final result', async () => {
    const dsl = makeOrchestration('sequential');
    const orchestrator = new AgentOrchestrator(dsl);
    let doneResult: string | null = null;

    orchestrator.events.on('orchestration', (e) => {
      if (e.type === 'done') doneResult = e.result;
    });

    await orchestrator.run('task', {
      executors: {
        'ref:supervisor': mockExecutor(['s']),
        'ref:worker-a':   mockExecutor(['a']),
        'ref:worker-b':   mockExecutor(['final answer']),
      },
    });

    expect(doneResult).not.toBeNull();
    expect(doneResult).toBe('final answer');
  });
});

// ─────────────────────────────────────────────────────────────
// mockExecutor Helper
// ─────────────────────────────────────────────────────────────

describe('mockExecutor', () => {
  it('cycles through responses', async () => {
    const exec = mockExecutor(['a', 'b', 'c']);
    const ctx = { sessionId: 'test', task: 'x', messages: [], sharedState: {}, round: 1, done: false };
    expect(await exec('agent', ctx)).toBe('a');
    expect(await exec('agent', ctx)).toBe('b');
    expect(await exec('agent', ctx)).toBe('c');
    expect(await exec('agent', ctx)).toBe('a'); // wraps around
  });
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
