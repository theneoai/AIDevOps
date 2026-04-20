/**
 * Status Command
 *
 * Shows the status of all registered components in Dify.
 */

import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../core/config';
import { DifyClient } from '../registry/dify-client';

export interface StatusOptions {
  configPath?: string;
  verbose?: boolean;
}

export async function statusCommand(options: StatusOptions): Promise<void> {
  const config = loadConfig();
  const spinner = ora('Fetching component status...').start();

  try {
    const client = new DifyClient(config);
    await client.connect();

    try {
      const status = await client.getStatus();
      spinner.stop();

      console.log(chalk.bold('\n📦 API Tool Providers'));
      console.log(chalk.gray('─'.repeat(50)));
      if (status.apiProviders.length === 0) {
        console.log(chalk.gray('  No API providers registered'));
      } else {
        for (const provider of status.apiProviders) {
          console.log(`  ${chalk.cyan(provider.name)} ${chalk.gray(`(id: ${provider.id})`)}`);
          console.log(`    Updated: ${provider.updatedAt.toLocaleString()}`);
        }
      }

      console.log(chalk.bold('\n🔌 MCP Tool Providers'));
      console.log(chalk.gray('─'.repeat(50)));
      if (status.mcpProviders.length === 0) {
        console.log(chalk.gray('  No MCP providers registered'));
      } else {
        for (const provider of status.mcpProviders) {
          console.log(`  ${chalk.cyan(provider.name)} ${chalk.gray(`(id: ${provider.id})`)}`);
          console.log(`    Updated: ${provider.updatedAt.toLocaleString()}`);
        }
      }

      console.log();
    } finally {
      await client.disconnect();
    }
  } catch (error) {
    spinner.fail(chalk.red(`Failed to fetch status: ${error instanceof Error ? error.message : String(error)}`));
    if (options.verbose && error instanceof Error && error.stack) {
      console.error(chalk.gray(error.stack));
    }
    process.exit(1);
  }
}
