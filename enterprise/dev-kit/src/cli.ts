#!/usr/bin/env node
/**
 * Dify DevKit CLI Entry Point
 *
 * Provides commands for creating, deploying, validating, and testing Dify components.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createCommand } from './commands/create';
import { deployCommand } from './commands/deploy';
import { statusCommand } from './commands/status';
import { validateCommand } from './commands/validate';
import { testRunCommand } from './commands/test-run';
import { watchCommand } from './commands/watch';
import { syncPromptsCommand } from './commands/sync-prompts';
import { searchCommand, installCommand, publishCommand } from './commands/registry';

const program = new Command();

program
  .name('dify-dev')
  .description('Dify DevKit - CLI tool for creating Dify components via code')
  .version('0.3.0')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('-v, --verbose', 'Enable verbose output', false)
  .option('--dry-run', 'Show what would be done without making changes', false)
  .option('--tenant <name>', 'Target tenant name (multi-tenancy)');

// ─────────────────────────────────────────────────────────────
// Create Command
// ─────────────────────────────────────────────────────────────

program
  .command('create')
  .description('Create a new component from a template')
  .argument('<kind>', 'Component kind: tool | workflow | agent | orchestration | chatflow')
  .argument('<name>', 'Component name')
  .option('-t, --type <type>', 'Tool type: api or mcp (for kind=tool)', 'api')
  .action(async (kind: string, name: string, options: { type: string }) => {
    if (kind !== 'tool') {
      console.error(chalk.red(`Error: Unsupported component kind "${kind}". Only "tool" is supported currently.`));
      process.exit(1);
    }

    const type = options.type as 'api' | 'mcp';
    if (type !== 'api' && type !== 'mcp') {
      console.error(chalk.red(`Error: Invalid tool type "${type}". Must be "api" or "mcp".`));
      process.exit(1);
    }

    await createCommand(name, {
      type,
      configPath: program.opts().config,
      verbose: program.opts().verbose,
    });
  });

// ─────────────────────────────────────────────────────────────
// Deploy Command
// ─────────────────────────────────────────────────────────────

program
  .command('deploy')
  .description('Deploy a component to Dify')
  .argument('<name>', 'Component name')
  .action(async (name: string) => {
    await deployCommand(name, {
      configPath: program.opts().config,
      verbose: program.opts().verbose,
      dryRun: program.opts().dryRun,
    });
  });

// ─────────────────────────────────────────────────────────────
// Status Command
// ─────────────────────────────────────────────────────────────

program
  .command('status')
  .description('Show status of deployed components (use --offline to skip Dify connection)')
  .option('--offline', 'Show local component files without connecting to Dify', false)
  .action(async (options: { offline: boolean }) => {
    await statusCommand({
      configPath: program.opts().config,
      verbose: program.opts().verbose,
      offline: options.offline,
    });
  });

// ─────────────────────────────────────────────────────────────
// Validate Command
// ─────────────────────────────────────────────────────────────

program
  .command('validate')
  .description('Validate component DSL files (schema + semantics + registry refs)')
  .argument('[name]', 'Component name (omit with --all to validate all)')
  .option('-a, --all', 'Validate all components in the components directory', false)
  .option('-l, --level <n>', 'Validation depth: 1=schema, 2=semantic, 3=registry (default: 3)', '3')
  .action(async (name: string | undefined, options: { all: boolean; level: string }) => {
    await validateCommand(name, {
      configPath: program.opts().config,
      verbose: program.opts().verbose,
      all: options.all,
      level: parseInt(options.level, 10),
    });
  });

// ─────────────────────────────────────────────────────────────
// Test Command (dry-run with mocks)
// ─────────────────────────────────────────────────────────────

program
  .command('test')
  .description('Dry-run a Workflow or Orchestration with mock responses')
  .argument('<name>', 'Component name')
  .option('-i, --input <kv...>', 'Input key=value pairs (e.g. --input topic="AI trends")')
  .option('-m, --mock-file <path>', 'JSON file with mock agent/step responses')
  .option('-o, --output <path>', 'Export compiled workflow graph to JSON file')
  .option('-r, --max-rounds <n>', 'Max orchestration rounds for supervisor/round_robin', '5')
  .action(async (name: string, options: { input?: string[]; mockFile?: string; output?: string; maxRounds?: string }) => {
    await testRunCommand(name, {
      configPath: program.opts().config,
      verbose: program.opts().verbose,
      input: options.input,
      mockFile: options.mockFile,
      output: options.output,
      maxRounds: options.maxRounds ? parseInt(options.maxRounds, 10) : undefined,
    });
  });

// ─────────────────────────────────────────────────────────────
// Watch Command (P4-2: hot reload)
// ─────────────────────────────────────────────────────────────

program
  .command('watch')
  .description('Watch component files and hot-deploy on change')
  .option('-p, --pattern <glob>', 'File glob pattern to watch', 'enterprise/components/**/*.yml')
  .option('-d, --debounce <ms>', 'Debounce delay in ms', '500')
  .action(async (options: { pattern: string; debounce: string }) => {
    await watchCommand({
      pattern: options.pattern,
      debounce: parseInt(options.debounce, 10),
      verbose: program.opts().verbose,
    });
  });

// ─────────────────────────────────────────────────────────────
// Sync Prompts Command (P4-3: Langfuse integration)
// ─────────────────────────────────────────────────────────────

program
  .command('sync-prompts')
  .description('Pull latest prompt versions from Langfuse into component DSL')
  .argument('<component>', 'Path to component YAML file')
  .action(async (componentPath: string) => {
    await syncPromptsCommand(componentPath, {
      dryRun: program.opts().dryRun,
      verbose: program.opts().verbose,
    });
  });

// ─────────────────────────────────────────────────────────────
// Registry Commands (P5-2: component marketplace)
// ─────────────────────────────────────────────────────────────

program
  .command('search')
  .description('Search the component registry')
  .argument('<query>', 'Search query (name, tag, or keyword)')
  .option('-r, --registry <url>', 'Custom registry index URL')
  .action(async (query: string, options: { registry?: string }) => {
    await searchCommand(query, {
      registryUrl: options.registry,
      verbose: program.opts().verbose,
    });
  });

program
  .command('install')
  .description('Install a component from the registry')
  .argument('<name[@version]>', 'Component name and optional version (e.g. wechat-publisher@1.0.0)')
  .option('-r, --registry <url>', 'Custom registry index URL')
  .action(async (nameVersion: string, options: { registry?: string }) => {
    await installCommand(nameVersion, {
      registryUrl: options.registry,
      verbose: program.opts().verbose,
    });
  });

program
  .command('publish')
  .description('Publish a component to the registry (runs quality gate first)')
  .argument('<path>', 'Path to component directory or component.yml file')
  .option('-r, --registry <url>', 'Custom registry index URL')
  .action(async (componentPath: string, options: { registry?: string }) => {
    await publishCommand(componentPath, {
      registryUrl: options.registry,
      dryRun: program.opts().dryRun,
      verbose: program.opts().verbose,
    });
  });

// ─────────────────────────────────────────────────────────────
// Parse
// ─────────────────────────────────────────────────────────────

program.parse();
