/**
 * Status Command
 *
 * --offline  (default when DIFY_BASE_URL not set): reads component YAML files
 *            from the local componentsDir — no network calls, no Dify required.
 *
 * online mode: lists providers registered in Dify via the REST API.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../core/config';
import { DifyClient } from '../registry/dify-client';

export interface StatusOptions {
  configPath?: string;
  verbose?: boolean;
  offline?: boolean;
}

// ─────────────────────────────────────────────────────────────
// Offline: read local component files
// ─────────────────────────────────────────────────────────────

function statusOffline(options: StatusOptions): void {
  const config = loadConfig();
  const dir = config.componentsDir;

  console.log(chalk.bold('\n[offline] Local Component Files'));
  console.log(chalk.gray(`Directory: ${path.resolve(dir)}`));
  console.log(chalk.gray('─'.repeat(50)));

  if (!fs.existsSync(dir)) {
    console.log(chalk.yellow(`  Components directory not found: ${dir}`));
    console.log(chalk.gray('  Run: dify-dev create tool <name>'));
    return;
  }

  const yamlFiles = walkYaml(dir);

  if (yamlFiles.length === 0) {
    console.log(chalk.gray('  No component YAML files found.'));
    return;
  }

  const byKind: Record<string, Array<{ name: string; version?: string; file: string }>> = {};

  for (const filePath of yamlFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const raw = yaml.parse(content) as Record<string, unknown>;
      const kind = String(raw?.kind ?? 'Unknown');
      const meta = (raw?.metadata ?? {}) as Record<string, unknown>;
      const name = String(meta.name ?? path.basename(filePath));
      const version = meta.version ? String(meta.version) : undefined;
      const rel = path.relative(dir, filePath);

      if (!byKind[kind]) byKind[kind] = [];
      byKind[kind].push({ name, version, file: rel });
    } catch {
      // skip malformed files silently; validate command will report them
    }
  }

  for (const [kind, components] of Object.entries(byKind)) {
    console.log(chalk.bold(`\n  ${kind} (${components.length})`));
    for (const c of components) {
      const ver = c.version ? chalk.gray(`@${c.version}`) : '';
      console.log(`    ${chalk.cyan(c.name)}${ver}  ${chalk.gray(c.file)}`);
    }
  }

  console.log();
  console.log(chalk.gray(`Total: ${yamlFiles.length} component(s) found locally.`));
  console.log(chalk.gray('Run without --offline to see Dify registration status.'));
}

function walkYaml(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkYaml(full));
    } else if (entry.isFile() && (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml'))) {
      results.push(full);
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────
// Online: query Dify API
// ─────────────────────────────────────────────────────────────

async function statusOnline(options: StatusOptions): Promise<void> {
  const config = loadConfig();
  const spinner = ora('Fetching component status from Dify...').start();

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
    spinner.stop();
    const msg = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`\nFailed to reach Dify: ${msg}`));
    console.log(chalk.yellow('\nFalling back to offline status...'));
    statusOffline(options);

    if (options.verbose && error instanceof Error && error.stack) {
      console.error(chalk.gray(error.stack));
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Entry Point
// ─────────────────────────────────────────────────────────────

export async function statusCommand(options: StatusOptions): Promise<void> {
  const config = loadConfig();

  // Auto-detect offline mode: use it when no Dify URL is configured
  const difyUrl = config.dify.baseUrl ?? config.dify.apiUrl ?? '';
  const isDifyConfigured = difyUrl !== '' && !difyUrl.includes('localhost') || process.env.DIFY_API_KEY;

  if (options.offline || (!isDifyConfigured && options.offline !== false)) {
    statusOffline(options);
    return;
  }

  await statusOnline(options);
}
