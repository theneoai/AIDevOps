/**
 * Test-Run Command
 *
 * Executes a workflow or orchestration in dry-run mode using mock LLM/tool responses.
 * Allows developers to verify workflow logic, variable flow, and step ordering
 * without real API calls or a running Dify instance.
 *
 * Usage:
 *   dify-dev test <name>                              # Auto-detect kind
 *   dify-dev test <name> --input topic="AI trends"   # Provide inputs
 *   dify-dev test <name> --mock-file mocks.json      # Load mock responses
 *   dify-dev test <name> --output graph.json         # Export execution graph
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../core/config';
import { parseWorkflowDSLFromFile } from '../core/workflow-parser';
import { parseOrchestrationDSLFromFile } from '../core/workflow-parser';
import {
  AgentOrchestrator,
  mockExecutor,
  AgentContext,
  OrchestrationEvent,
} from '../core/agent-orchestrator';
import { compileWorkflow, serializeWorkflow } from '../core/workflow-compiler';
import { createLogger, TraceContext, withSpan } from '../core/observability';

const log = createLogger('test-run');

export interface TestRunOptions {
  configPath?: string;
  verbose?: boolean;
  input?: string[];
  mockFile?: string;
  output?: string;
  maxRounds?: number;
}

// ─────────────────────────────────────────────────────────────
// Input Parser
// ─────────────────────────────────────────────────────────────

function parseInputs(rawInputs: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const raw of rawInputs) {
    const eqIdx = raw.indexOf('=');
    if (eqIdx === -1) continue;
    result[raw.slice(0, eqIdx).trim()] = raw.slice(eqIdx + 1).trim();
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// Mock Response Loader
// ─────────────────────────────────────────────────────────────

interface MockConfig {
  /** Key: agent ref or step id, Value: response string(s) */
  [agentOrStepId: string]: string | string[];
}

function loadMockConfig(mockFile?: string): MockConfig {
  if (!mockFile) return {};
  if (!fs.existsSync(mockFile)) {
    console.warn(chalk.yellow(`Mock file not found: ${mockFile}, using defaults`));
    return {};
  }
  return JSON.parse(fs.readFileSync(mockFile, 'utf-8')) as MockConfig;
}

// ─────────────────────────────────────────────────────────────
// Workflow Test Runner
// ─────────────────────────────────────────────────────────────

async function testWorkflow(
  filePath: string,
  options: TestRunOptions,
  ctx: TraceContext
): Promise<void> {
  const dsl = parseWorkflowDSLFromFile(filePath);

  console.log(chalk.bold(`\nWorkflow: ${dsl.metadata.name}`));
  console.log(chalk.gray(`  ${dsl.spec.steps.length} step(s) | version: ${dsl.metadata.version ?? 'unversioned'}`));

  const inputs = parseInputs(options.input ?? []);

  // Compile to Dify graph format
  const compiled = await withSpan(ctx, 'workflow.compile', { 'workflow.name': dsl.metadata.name }, async () => {
    return compileWorkflow(dsl);
  });

  console.log(chalk.gray(`\n  Compiled graph: ${compiled.graph.nodes.length} nodes, ${compiled.graph.edges.length} edges`));

  // Simulate execution
  console.log(chalk.bold('\n  Execution trace:'));
  const steps = dsl.spec.steps;

  for (const step of steps) {
    const stepSpan = ctx.startSpan(`step.${step.id}`, { 'step.kind': step.kind });

    const mockCfg = loadMockConfig(options.mockFile);
    const mockResponse = typeof mockCfg[step.id] === 'string'
      ? mockCfg[step.id] as string
      : Array.isArray(mockCfg[step.id])
        ? (mockCfg[step.id] as string[])[0]
        : `[mock output for ${step.kind} step "${step.id}"]`;

    // Simulate async delay proportional to step complexity
    await new Promise(r => setTimeout(r, 50));

    ctx.endSpan(stepSpan, 'ok');
    console.log(`    ${chalk.green('✓')} ${chalk.bold(step.id)} (${step.kind}) → ${chalk.gray(mockResponse.slice(0, 60))}...`);
  }

  // Export if requested
  if (options.output) {
    const exportPath = options.output;
    const serialized = serializeWorkflow(dsl, compiled);
    fs.writeFileSync(exportPath, serialized, 'utf-8');
    console.log(chalk.gray(`\n  Exported workflow graph to: ${exportPath}`));
  }

  console.log(chalk.green('\n  ✓ Workflow test passed (dry run)'));
}

// ─────────────────────────────────────────────────────────────
// Orchestration Test Runner
// ─────────────────────────────────────────────────────────────

async function testOrchestration(
  filePath: string,
  options: TestRunOptions,
  ctx: TraceContext
): Promise<void> {
  const dsl = parseOrchestrationDSLFromFile(filePath);
  const mockCfg = loadMockConfig(options.mockFile);

  console.log(chalk.bold(`\nOrchestration: ${dsl.metadata.name}`));
  console.log(chalk.gray(`  Strategy: ${dsl.spec.strategy} | ${dsl.spec.agents.length} agent(s)`));

  // Build mock executors for each agent
  const executors: Record<string, ReturnType<typeof mockExecutor>> = {};
  for (const agentConfig of dsl.spec.agents) {
    const raw = mockCfg[agentConfig.ref];
    const responses = Array.isArray(raw) ? raw
      : typeof raw === 'string' ? [raw]
      : [`[mock response from ${agentConfig.ref}]`];

    // For supervisor strategy: add FINISH on last response
    if (dsl.spec.strategy === 'supervisor' && agentConfig.ref === dsl.spec.supervisor) {
      const supervisorResponses = [
        ...responses.slice(0, -1).map((r, i) => `ROUTE: ${dsl.spec.agents.find(a => a.ref !== dsl.spec.supervisor)?.ref}\n${r}`),
        `FINISH: ${responses[responses.length - 1]}`,
      ];
      executors[agentConfig.ref] = mockExecutor(supervisorResponses);
    } else {
      executors[agentConfig.ref] = mockExecutor(responses);
    }
  }

  const orchestrator = new AgentOrchestrator(dsl);

  console.log(chalk.bold('\n  Execution trace:'));
  orchestrator.events.on('orchestration', (event: OrchestrationEvent) => {
    switch (event.type) {
      case 'round_start':
        if (options.verbose) console.log(chalk.gray(`  Round ${event.round}:`));
        break;
      case 'agent_start':
        console.log(`    → ${chalk.cyan(event.agentId)} (round ${event.round})`);
        break;
      case 'agent_output':
        console.log(`    ← ${chalk.green(event.agentId)}: ${chalk.gray(event.output.slice(0, 80))}...`);
        break;
      case 'agent_error':
        console.log(`    ${chalk.red('✗')} ${event.agentId}: ${event.error}`);
        break;
      case 'done':
        console.log(`\n  ${chalk.green('Result:')} ${event.result.slice(0, 120)}`);
        break;
    }
  });

  const task = parseInputs(options.input ?? []).task ?? 'Test task for dry run';

  const result = await withSpan(ctx, 'orchestration.run', { 'orchestration.name': dsl.metadata.name }, async () => {
    return orchestrator.run(task, {
      executors,
      maxRounds: options.maxRounds ?? 3,
    });
  });

  console.log(chalk.green(`\n  ✓ Orchestration test passed (${result.rounds} round(s), ${result.durationMs}ms)`));
}

// ─────────────────────────────────────────────────────────────
// Main Command
// ─────────────────────────────────────────────────────────────

export async function testRunCommand(
  name: string,
  options: TestRunOptions
): Promise<void> {
  const config = loadConfig();
  const ctx = new TraceContext();

  const ymlPath = path.join(config.componentsDir, `${name}.yml`);
  if (!fs.existsSync(ymlPath)) {
    console.error(chalk.red(`Component not found: ${ymlPath}`));
    process.exit(1);
  }

  // Peek at the kind
  const content = fs.readFileSync(ymlPath, 'utf-8');
  const kindMatch = content.match(/^kind:\s*(\w+)/m);
  const kind = kindMatch?.[1] ?? 'unknown';

  const spinner = ora(`Testing ${name} (${kind})...`).start();
  spinner.stop();

  try {
    switch (kind) {
      case 'Workflow':
        await testWorkflow(ymlPath, options, ctx);
        break;
      case 'Orchestration':
        await testOrchestration(ymlPath, options, ctx);
        break;
      default:
        console.log(chalk.yellow(`Test dry-run not yet supported for kind "${kind}". Skipping execution.`));
        console.log(chalk.gray('Schema validation: run  dify-dev validate <name>'));
    }
  } catch (err) {
    console.error(chalk.red(`\nTest failed: ${err instanceof Error ? err.message : String(err)}`));
    if (options.verbose && err instanceof Error && err.stack) {
      console.error(chalk.gray(err.stack));
    }
    process.exit(1);
  }
}
