/**
 * Deploy Command
 *
 * Deploys a component to Dify by parsing, compiling, and registering.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../core/config';
import { DifyClient } from '../registry/dify-client';

export interface DeployOptions {
  configPath?: string;
  verbose?: boolean;
  dryRun?: boolean;
}

export async function deployCommand(name: string, options: DeployOptions): Promise<void> {
  const config = loadConfig();
  const componentsDir = config.componentsDir;
  const filePath = path.join(componentsDir, `${name}.yml`);

  if (!fs.existsSync(filePath)) {
    console.error(chalk.red(`Error: Component not found: ${filePath}`));
    console.error(chalk.gray(`  Run 'dify-dev create tool ${name}' to create it.`));
    process.exit(1);
  }

  const spinner = ora(`Deploying ${name}...`).start();

  try {
    if (options.dryRun) {
      spinner.info(`Dry run: Would deploy ${name} from ${filePath}`);
      return;
    }

    const client = new DifyClient(config);
    await client.connect();

    try {
      const result = await client.registerToolFromFile(filePath);
      spinner.succeed(
        chalk.green(
          `${result.action === 'updated' ? 'Updated' : 'Created'} ${result.providerType} provider: ${result.providerId}`
        )
      );
      if (options.verbose) {
        console.log(chalk.gray(`  ${result.message}`));
      }
    } finally {
      await client.disconnect();
    }
  } catch (error) {
    spinner.fail(chalk.red(`Deployment failed: ${error instanceof Error ? error.message : String(error)}`));
    if (options.verbose && error instanceof Error && error.stack) {
      console.error(chalk.gray(error.stack));
    }
    process.exit(1);
  }
}
