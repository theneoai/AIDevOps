/**
 * Multi-Agent Orchestration Engine
 *
 * Implements three coordination patterns for enterprise agent teams:
 *
 * 1. Supervisor Pattern  – One LLM-powered supervisor routes tasks to specialized workers.
 *    Inspired by LangGraph's supervisor architecture and CrewAI's hierarchical process.
 *
 * 2. Sequential Pipeline – Agents execute in order, each consuming the previous output.
 *    Suitable for linear content pipelines (research → draft → review → publish).
 *
 * 3. Parallel Ensemble   – Multiple agents tackle the problem independently; results
 *    are merged by a final aggregator step. Good for diversity of thought / A/B eval.
 *
 * All coordination is event-driven via an in-process EventBus.
 * The design is intentionally agnostic of the underlying LLM provider so it can
 * drive Dify agents, raw Anthropic SDK calls, or mock agents in tests.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { OrchestrationDSL, OrchestrationSpec } from '../types/dsl';

// ─────────────────────────────────────────────────────────────
// Core Types
// ─────────────────────────────────────────────────────────────

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentId?: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface AgentContext {
  /** Unique session id */
  sessionId: string;
  /** Original user task */
  task: string;
  /** Accumulated conversation history */
  messages: AgentMessage[];
  /** Shared key-value state updated by agents */
  sharedState: Record<string, unknown>;
  /** Current round (for supervisor/round_robin) */
  round: number;
  /** Whether the orchestration should stop */
  done: boolean;
  /** Final result if done */
  result?: string;
}

export interface AgentExecutorFn {
  (agentId: string, context: AgentContext): Promise<string>;
}

export interface OrchestrationOptions {
  /** Override max rounds from DSL */
  maxRounds?: number;
  /** Inject mock executors for testing */
  executors?: Record<string, AgentExecutorFn>;
  /** Called when an agent produces output */
  onAgentOutput?: (agentId: string, output: string, context: AgentContext) => void;
  /** Called when orchestration completes */
  onComplete?: (result: string, context: AgentContext) => void;
}

export interface OrchestrationResult {
  sessionId: string;
  task: string;
  rounds: number;
  result: string;
  messages: AgentMessage[];
  sharedState: Record<string, unknown>;
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────
// Event Bus
// ─────────────────────────────────────────────────────────────

export type OrchestrationEvent =
  | { type: 'agent_start';   agentId: string; round: number }
  | { type: 'agent_output';  agentId: string; output: string; round: number }
  | { type: 'agent_error';   agentId: string; error: string; round: number }
  | { type: 'round_start';   round: number }
  | { type: 'round_end';     round: number }
  | { type: 'hitl_pending';  agentId: string; message: string }
  | { type: 'done';          result: string };

export class OrchestrationEventBus extends EventEmitter {
  emit(event: 'orchestration', data: OrchestrationEvent): boolean {
    return super.emit('orchestration', data);
  }
  on(event: 'orchestration', listener: (data: OrchestrationEvent) => void): this {
    return super.on(event, listener);
  }
}

// ─────────────────────────────────────────────────────────────
// Default Executor (Placeholder for Dify/Anthropic integration)
// ─────────────────────────────────────────────────────────────

function defaultExecutor(agentId: string): AgentExecutorFn {
  return async (_id, ctx) => {
    // Real implementation would call Dify API or Anthropic SDK here.
    // This default signals misconfiguration clearly.
    throw new Error(
      `No executor registered for agent "${agentId}". ` +
      'Pass executors in OrchestrationOptions or configure a Dify client.'
    );
  };
}

// ─────────────────────────────────────────────────────────────
// Supervisor Orchestrator
// ─────────────────────────────────────────────────────────────

async function runSupervisorOrchestration(
  spec: OrchestrationSpec,
  context: AgentContext,
  options: OrchestrationOptions,
  bus: OrchestrationEventBus
): Promise<void> {
  const supervisorRef = spec.supervisor!;
  const workerRefs = spec.agents
    .filter(a => a.ref !== supervisorRef)
    .map(a => a.ref);

  const maxRounds = options.maxRounds ?? spec.maxRounds ?? 10;

  while (!context.done && context.round < maxRounds) {
    context.round++;
    bus.emit('orchestration', { type: 'round_start', round: context.round });

    // 1. Supervisor decides which worker to invoke (or finishes)
    bus.emit('orchestration', { type: 'agent_start', agentId: supervisorRef, round: context.round });
    const supervisorExec = options.executors?.[supervisorRef] ?? defaultExecutor(supervisorRef);

    let supervisorOutput: string;
    try {
      supervisorOutput = await supervisorExec(supervisorRef, context);
    } catch (err) {
      bus.emit('orchestration', { type: 'agent_error', agentId: supervisorRef, error: String(err), round: context.round });
      throw err;
    }

    bus.emit('orchestration', { type: 'agent_output', agentId: supervisorRef, output: supervisorOutput, round: context.round });
    options.onAgentOutput?.(supervisorRef, supervisorOutput, context);

    context.messages.push({ role: 'assistant', content: supervisorOutput, agentId: supervisorRef, timestamp: new Date() });

    // 2. Parse supervisor routing decision (convention: "ROUTE:<workerId>" or "FINISH:<result>")
    const finishMatch = supervisorOutput.match(/FINISH:\s*([\s\S]+)/);
    if (finishMatch) {
      context.done = true;
      context.result = finishMatch[1].trim();
      bus.emit('orchestration', { type: 'done', result: context.result });
      break;
    }

    const routeMatch = supervisorOutput.match(/ROUTE:\s*(\S+)/);
    const targetWorker = routeMatch ? routeMatch[1] : workerRefs[0];

    // 3. Execute target worker
    if (targetWorker) {
      bus.emit('orchestration', { type: 'agent_start', agentId: targetWorker, round: context.round });
      const workerExec = options.executors?.[targetWorker] ?? defaultExecutor(targetWorker);

      let workerOutput: string;
      try {
        workerOutput = await workerExec(targetWorker, context);
      } catch (err) {
        bus.emit('orchestration', { type: 'agent_error', agentId: targetWorker, error: String(err), round: context.round });
        throw err;
      }

      bus.emit('orchestration', { type: 'agent_output', agentId: targetWorker, output: workerOutput, round: context.round });
      options.onAgentOutput?.(targetWorker, workerOutput, context);
      context.messages.push({ role: 'assistant', content: workerOutput, agentId: targetWorker, timestamp: new Date() });
    }

    bus.emit('orchestration', { type: 'round_end', round: context.round });
  }

  if (!context.done) {
    context.result = context.messages.filter(m => m.role === 'assistant').pop()?.content ?? '';
    context.done = true;
  }
}

// ─────────────────────────────────────────────────────────────
// Sequential Orchestrator
// ─────────────────────────────────────────────────────────────

async function runSequentialOrchestration(
  spec: OrchestrationSpec,
  context: AgentContext,
  options: OrchestrationOptions,
  bus: OrchestrationEventBus
): Promise<void> {
  context.round = 1;
  bus.emit('orchestration', { type: 'round_start', round: 1 });

  for (const agentConfig of spec.agents) {
    bus.emit('orchestration', { type: 'agent_start', agentId: agentConfig.ref, round: context.round });
    const exec = options.executors?.[agentConfig.ref] ?? defaultExecutor(agentConfig.ref);

    let output: string;
    try {
      output = await exec(agentConfig.ref, context);
    } catch (err) {
      bus.emit('orchestration', { type: 'agent_error', agentId: agentConfig.ref, error: String(err), round: context.round });
      throw err;
    }

    bus.emit('orchestration', { type: 'agent_output', agentId: agentConfig.ref, output, round: context.round });
    options.onAgentOutput?.(agentConfig.ref, output, context);
    context.messages.push({ role: 'assistant', content: output, agentId: agentConfig.ref, timestamp: new Date() });
    context.sharedState[`${agentConfig.ref}_output`] = output;
  }

  bus.emit('orchestration', { type: 'round_end', round: 1 });
  context.result = context.messages.filter(m => m.role === 'assistant').pop()?.content ?? '';
  context.done = true;
  bus.emit('orchestration', { type: 'done', result: context.result });
}

// ─────────────────────────────────────────────────────────────
// Parallel Orchestrator
// ─────────────────────────────────────────────────────────────

async function runParallelOrchestration(
  spec: OrchestrationSpec,
  context: AgentContext,
  options: OrchestrationOptions,
  bus: OrchestrationEventBus
): Promise<void> {
  context.round = 1;
  bus.emit('orchestration', { type: 'round_start', round: 1 });

  const results = await Promise.allSettled(
    spec.agents.map(async (agentConfig) => {
      bus.emit('orchestration', { type: 'agent_start', agentId: agentConfig.ref, round: 1 });
      const exec = options.executors?.[agentConfig.ref] ?? defaultExecutor(agentConfig.ref);
      const output = await exec(agentConfig.ref, context);
      bus.emit('orchestration', { type: 'agent_output', agentId: agentConfig.ref, output, round: 1 });
      options.onAgentOutput?.(agentConfig.ref, output, context);
      return { agentId: agentConfig.ref, output };
    })
  );

  bus.emit('orchestration', { type: 'round_end', round: 1 });

  const successOutputs: string[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      const { agentId, output } = r.value;
      context.messages.push({ role: 'assistant', content: output, agentId, timestamp: new Date() });
      context.sharedState[`${agentId}_output`] = output;
      successOutputs.push(`[${agentId}]: ${output}`);
    }
  }

  const outputFormat = spec.outputFormat ?? 'aggregated';
  if (outputFormat === 'aggregated') {
    context.result = successOutputs.join('\n\n---\n\n');
  } else if (outputFormat === 'last_agent') {
    context.result = successOutputs[successOutputs.length - 1] ?? '';
  } else {
    context.result = successOutputs.join('\n\n---\n\n');
  }

  context.done = true;
  bus.emit('orchestration', { type: 'done', result: context.result });
}

// ─────────────────────────────────────────────────────────────
// Round-Robin Orchestrator
// ─────────────────────────────────────────────────────────────

async function runRoundRobinOrchestration(
  spec: OrchestrationSpec,
  context: AgentContext,
  options: OrchestrationOptions,
  bus: OrchestrationEventBus
): Promise<void> {
  const maxRounds = options.maxRounds ?? spec.maxRounds ?? spec.agents.length;
  let agentIdx = 0;

  while (!context.done && context.round < maxRounds) {
    context.round++;
    bus.emit('orchestration', { type: 'round_start', round: context.round });

    const agentConfig = spec.agents[agentIdx % spec.agents.length];
    agentIdx++;

    bus.emit('orchestration', { type: 'agent_start', agentId: agentConfig.ref, round: context.round });
    const exec = options.executors?.[agentConfig.ref] ?? defaultExecutor(agentConfig.ref);

    let output: string;
    try {
      output = await exec(agentConfig.ref, context);
    } catch (err) {
      bus.emit('orchestration', { type: 'agent_error', agentId: agentConfig.ref, error: String(err), round: context.round });
      throw err;
    }

    bus.emit('orchestration', { type: 'agent_output', agentId: agentConfig.ref, output, round: context.round });
    options.onAgentOutput?.(agentConfig.ref, output, context);
    context.messages.push({ role: 'assistant', content: output, agentId: agentConfig.ref, timestamp: new Date() });

    bus.emit('orchestration', { type: 'round_end', round: context.round });
  }

  context.result = context.messages.filter(m => m.role === 'assistant').pop()?.content ?? '';
  context.done = true;
}

// ─────────────────────────────────────────────────────────────
// Main Orchestrator Class
// ─────────────────────────────────────────────────────────────

export class AgentOrchestrator {
  private dsl: OrchestrationDSL;
  private bus: OrchestrationEventBus;

  constructor(dsl: OrchestrationDSL) {
    this.dsl = dsl;
    this.bus = new OrchestrationEventBus();
  }

  get events(): OrchestrationEventBus {
    return this.bus;
  }

  async run(task: string, options: OrchestrationOptions = {}): Promise<OrchestrationResult> {
    const startMs = Date.now();
    const sessionId = `sess_${randomUUID()}`;

    const context: AgentContext = {
      sessionId,
      task,
      messages: [{ role: 'user', content: task, timestamp: new Date() }],
      sharedState: { ...(this.dsl.spec.sharedContext || {}) },
      round: 0,
      done: false,
    };

    const { spec } = this.dsl;

    switch (spec.strategy) {
      case 'supervisor':
        await runSupervisorOrchestration(spec, context, options, this.bus);
        break;
      case 'sequential':
        await runSequentialOrchestration(spec, context, options, this.bus);
        break;
      case 'parallel':
        await runParallelOrchestration(spec, context, options, this.bus);
        break;
      case 'round_robin':
        await runRoundRobinOrchestration(spec, context, options, this.bus);
        break;
    }

    options.onComplete?.(context.result ?? '', context);

    return {
      sessionId,
      task,
      rounds: context.round,
      result: context.result ?? '',
      messages: context.messages,
      sharedState: context.sharedState,
      durationMs: Date.now() - startMs,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Factory Helpers
// ─────────────────────────────────────────────────────────────

export function createOrchestrator(dsl: OrchestrationDSL): AgentOrchestrator {
  return new AgentOrchestrator(dsl);
}

/**
 * Create a mock executor for testing — returns a scripted response.
 */
export function mockExecutor(responses: string[]): AgentExecutorFn {
  let callCount = 0;
  return async (_agentId, _ctx) => {
    const response = responses[callCount % responses.length];
    callCount++;
    return response;
  };
}

/**
 * Create an executor that calls the Dify Workflow API via HTTP.
 */
export function difyWorkflowExecutor(
  difyBaseUrl: string,
  appId: string,
  apiKey: string
): AgentExecutorFn {
  return async (agentId, ctx) => {
    const resp = await fetch(`${difyBaseUrl}/v1/workflows/run`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: { task: ctx.task, history: ctx.messages.map(m => m.content).join('\n') },
        response_mode: 'blocking',
        user: ctx.sessionId,
      }),
    });
    const json = await resp.json() as { data?: { outputs?: { result?: string } } };
    return (json as { data?: { outputs?: { result?: string } } }).data?.outputs?.result ?? '';
  };
}
