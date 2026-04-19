/**
 * Validate Command
 *
 * Performs multi-level validation of component DSL files:
 *
 * Level 1 – Schema: Zod validation (catches type errors, missing fields)
 * Level 2 – Semantic: Workflow step id uniqueness, output ref validity
 * Level 3 – Registry: Unresolved "ref:..." cross-component references
 *
 * Usage:
 *   dify-dev validate <name>          # Validate single component
 *   dify-dev validate --all           # Validate all components in componentsDir
 *   dify-dev validate <name> --level 2  # Stop after semantic validation
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../core/config';
import { parseToolDSL } from '../core/parser';
import {
  parseWorkflowDSL,
  parseAgentDSL,
  parseOrchestrationDSL,
  parseChatflowDSL,
  validateWorkflowSemantics,
  ParseError,
} from '../core/workflow-parser';
import {
  getGlobalRegistry,
  extractWorkflowRefs,
  extractAgentRefs,
  extractOrchestrationRefs,
} from '../core/component-registry';
import { createLogger, recordDeploymentEvent, TraceContext, withSpan } from '../core/observability';

const log = createLogger('validate');

export interface ValidateOptions {
  configPath?: string;
  verbose?: boolean;
  all?: boolean;
  level?: number;
}

interface ValidationReport {
  file: string;
  kind: string;
  name: string;
  level1: { passed: boolean; errors: string[] };
  level2: { passed: boolean; errors: string[]; warnings: string[] };
  level3: { passed: boolean; unresolvedRefs: string[] };
  passed: boolean;
}

// ─────────────────────────────────────────────────────────────
// Single File Validation
// ─────────────────────────────────────────────────────────────

async function validateFile(
  filePath: string,
  options: ValidateOptions,
  ctx: TraceContext
): Promise<ValidationReport> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const fileName = path.basename(filePath);

  let raw: Record<string, unknown>;
  try {
    raw = yaml.parse(content);
  } catch (e) {
    return {
      file: fileName,
      kind: 'unknown',
      name: '(parse error)',
      level1: { passed: false, errors: [`YAML parse error: ${e}`] },
      level2: { passed: false, errors: [], warnings: [] },
      level3: { passed: false, unresolvedRefs: [] },
      passed: false,
    };
  }

  const kind = String(raw?.kind ?? 'unknown');
  const name = String((raw?.metadata as Record<string, unknown>)?.name ?? fileName);

  const report: ValidationReport = {
    file: fileName,
    kind,
    name,
    level1: { passed: true, errors: [] },
    level2: { passed: true, errors: [], warnings: [] },
    level3: { passed: true, unresolvedRefs: [] },
    passed: true,
  };

  // ── Level 1: Schema Validation ────────────────────────────

  let parsedDsl: unknown = null;
  await withSpan(ctx, 'validate.schema', { 'component.name': name, 'component.kind': kind }, async () => {
    try {
      switch (kind) {
        case 'Tool':          parsedDsl = parseToolDSL(content); break;
        case 'Workflow':      parsedDsl = parseWorkflowDSL(content); break;
        case 'Agent':         parsedDsl = parseAgentDSL(content); break;
        case 'Orchestration': parsedDsl = parseOrchestrationDSL(content); break;
        case 'Chatflow':      parsedDsl = parseChatflowDSL(content); break;
        default:
          report.level1.errors.push(`Unknown component kind: "${kind}"`);
          report.level1.passed = false;
      }
    } catch (err) {
      if (err instanceof ParseError) {
        report.level1.errors = err.details.map(
          d => `[${d.path.join('.')}] ${d.message}`
        );
      } else {
        report.level1.errors.push(String(err));
      }
      report.level1.passed = false;
    }
  });

  if (!report.level1.passed || options.level === 1) {
    report.passed = report.level1.passed;
    return report;
  }

  // ── Level 2: Semantic Validation ──────────────────────────

  await withSpan(ctx, 'validate.semantic', { 'component.name': name }, async () => {
    if (kind === 'Workflow' && parsedDsl) {
      const { errors, warnings } = validateWorkflowSemantics(parsedDsl as Parameters<typeof validateWorkflowSemantics>[0]);
      report.level2.errors = errors.map(e => `[${e.path}] ${e.message}`);
      report.level2.warnings = warnings.map(w => `[${w.path}] ${w.message}`);
      report.level2.passed = errors.length === 0;
    }
  });

  if (!report.level2.passed || options.level === 2) {
    report.passed = report.level2.passed;
    return report;
  }

  // ── Level 3: Registry Reference Validation ────────────────

  await withSpan(ctx, 'validate.refs', { 'component.name': name }, async () => {
    const registry = getGlobalRegistry();
    let refs: string[] = [];

    if (kind === 'Workflow' && parsedDsl) {
      refs = extractWorkflowRefs(parsedDsl as Parameters<typeof extractWorkflowRefs>[0]);
    } else if (kind === 'Agent' && parsedDsl) {
      refs = extractAgentRefs(parsedDsl as Parameters<typeof extractAgentRefs>[0]);
    } else if (kind === 'Orchestration' && parsedDsl) {
      refs = extractOrchestrationRefs(parsedDsl as Parameters<typeof extractOrchestrationRefs>[0]);
    }

    report.level3.unresolvedRefs = registry.validateRefs(refs);
    report.level3.passed = report.level3.unresolvedRefs.length === 0;
  });

  report.passed = report.level1.passed && report.level2.passed && report.level3.passed;
  return report;
}

// ─────────────────────────────────────────────────────────────
// Output Formatting
// ─────────────────────────────────────────────────────────────

function printReport(report: ValidationReport, verbose: boolean): void {
  const icon = report.passed ? chalk.green('✓') : chalk.red('✗');
  console.log(`${icon} ${chalk.bold(report.name)} ${chalk.gray(`(${report.kind})`)} — ${chalk.gray(report.file)}`);

  if (!report.level1.passed || verbose) {
    for (const err of report.level1.errors) {
      console.log(`  ${chalk.red('Schema:')} ${err}`);
    }
  }

  if (!report.level2.passed || verbose) {
    for (const err of report.level2.errors) {
      console.log(`  ${chalk.red('Semantic:')} ${err}`);
    }
  }

  if (verbose) {
    for (const warn of report.level2.warnings) {
      console.log(`  ${chalk.yellow('Warning:')} ${warn}`);
    }
  }

  if (!report.level3.passed || verbose) {
    for (const ref of report.level3.unresolvedRefs) {
      console.log(`  ${chalk.yellow('Unresolved ref:')} ${ref}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Main Command
// ─────────────────────────────────────────────────────────────

export async function validateCommand(
  name: string | undefined,
  options: ValidateOptions
): Promise<void> {
  const config = loadConfig();
  const ctx = new TraceContext();
  const spinner = ora('Validating...').start();

  let filePaths: string[] = [];

  if (options.all) {
    const dir = config.componentsDir;
    if (!fs.existsSync(dir)) {
      spinner.fail(chalk.red(`Components directory not found: ${dir}`));
      process.exit(1);
    }
    filePaths = fs.readdirSync(dir)
      .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map(f => path.join(dir, f));
  } else if (name) {
    const filePath = path.join(config.componentsDir, `${name}.yml`);
    if (!fs.existsSync(filePath)) {
      spinner.fail(chalk.red(`Component not found: ${filePath}`));
      process.exit(1);
    }
    filePaths = [filePath];
  } else {
    spinner.fail(chalk.red('Provide a component name or use --all'));
    process.exit(1);
  }

  spinner.stop();

  const reports: ValidationReport[] = [];
  for (const fp of filePaths) {
    const report = await validateFile(fp, options, ctx);
    reports.push(report);
    printReport(report, options.verbose ?? false);
  }

  const passed = reports.filter(r => r.passed).length;
  const failed = reports.filter(r => !r.passed).length;

  console.log('');
  if (failed === 0) {
    console.log(chalk.green(`All ${passed} component(s) valid.`));
  } else {
    console.log(chalk.red(`${failed} component(s) failed validation.`) + chalk.gray(` (${passed} passed)`));
    process.exit(1);
  }
}
