#!/usr/bin/env node
/**
 * Dify DevKit CLI Entry Point
 *
 * Provides commands for creating, deploying, and managing Dify components.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createCommand } from './commands/create';
import { deployCommand } from './commands/deploy';
import { statusCommand } from './commands/status';

const program = new Command();

program
  .name('dify-dev')
  .description('Dify DevKit - CLI tool for creating Dify components via code')
  .version('0.1.0')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('-v, --verbose', 'Enable verbose output', false)
  .option('--dry-run', 'Show what would be done without making changes', false);

// ─────────────────────────────────────────────────────────────
// Create Command
// ─────────────────────────────────────────────────────────────

program
  .command('create')
  .description('Create a new component from a template')
  .argument('<kind>', 'Component kind (e.g. tool)')
  .argument('<name>', 'Component name')
  .option('-t, --type <type>', 'Tool type: api or mcp', 'api')
  .action(async (kind: string, name: string, options: { type: string }) => {
    if (kind !== 'tool') {
      console.error(chalk.red(`Error: Unsupported component kind "${kind}". Only "tool" is supported.`));
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
  .description('Show status of all components')
  .action(async () => {
    await statusCommand({
      configPath: program.opts().config,
      verbose: program.opts().verbose,
    });
  });

// ─────────────────────────────────────────────────────────────
// Parse
// ─────────────────────────────────────────────────────────────

program.parse();
