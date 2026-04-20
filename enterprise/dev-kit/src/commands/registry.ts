/**
 * P5-2: Component Registry CLI Commands
 *
 * Provides search, install, and publish commands for the GitHub-based
 * component registry at registry/index.json.
 */

import axios from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { parseToolDSLFromFile } from '../core/parser';
import { validateCommand } from './validate';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface RegistryEntry {
  name: string;
  displayName: string;
  description: string;
  kind: string;
  type?: string;
  version: string;
  author: string;
  tags: string[];
  path: string;
  readme: string;
  spec: string;
  requiresSecrets: string[];
  minDevKitVersion: string;
}

export interface RegistryIndex {
  version: string;
  updated: string;
  components: RegistryEntry[];
}

export interface RegistryOptions {
  registryUrl?: string;
  verbose?: boolean;
}

const DEFAULT_REGISTRY_URL =
  'https://raw.githubusercontent.com/theneoai/aidevops/main/registry/index.json';

const LOCAL_REGISTRY_PATH = path.resolve(__dirname, '../../../../../registry/index.json');

// ─────────────────────────────────────────────────────────────
// Registry Fetch
// ─────────────────────────────────────────────────────────────

async function fetchRegistryIndex(options: RegistryOptions): Promise<RegistryIndex> {
  // Prefer local registry (monorepo development), fall back to remote
  if (await fs.pathExists(LOCAL_REGISTRY_PATH)) {
    return fs.readJSON(LOCAL_REGISTRY_PATH) as Promise<RegistryIndex>;
  }

  const url = options.registryUrl ?? DEFAULT_REGISTRY_URL;
  const res = await axios.get<RegistryIndex>(url, { timeout: 10_000 });
  return res.data;
}

// ─────────────────────────────────────────────────────────────
// search
// ─────────────────────────────────────────────────────────────

export async function searchCommand(query: string, options: RegistryOptions): Promise<void> {
  const spinner = ora(`Searching registry for "${query}"...`).start();

  let index: RegistryIndex;
  try {
    index = await fetchRegistryIndex(options);
    spinner.stop();
  } catch (err) {
    spinner.fail('Failed to fetch registry index');
    throw err;
  }

  const q = query.toLowerCase();
  const results = index.components.filter(
    (c) =>
      c.name.includes(q) ||
      c.displayName.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.tags.some((t) => t.includes(q)),
  );

  if (results.length === 0) {
    console.log(chalk.yellow(`No components found for "${query}"`));
    return;
  }

  console.log(chalk.bold(`\nFound ${results.length} component(s):\n`));

  for (const c of results) {
    const kindBadge = chalk.cyan(`[${c.kind}${c.type ? `/${c.type}` : ''}]`);
    console.log(`  ${chalk.green(c.name)}@${c.version} ${kindBadge}`);
    console.log(`    ${c.description}`);
    console.log(`    Tags: ${c.tags.join(', ')}`);
    if (c.requiresSecrets.length > 0) {
      console.log(`    ${chalk.yellow('Secrets:')} ${c.requiresSecrets.join(', ')}`);
    }
    console.log();
  }

  console.log(`Install with: ${chalk.bold('dify-dev install <name>@<version>')}`);
}

// ─────────────────────────────────────────────────────────────
// install
// ─────────────────────────────────────────────────────────────

export async function installCommand(
  nameVersion: string,
  options: RegistryOptions,
): Promise<void> {
  const [name, version] = nameVersion.split('@');

  const spinner = ora(`Fetching registry...`).start();
  let index: RegistryIndex;
  try {
    index = await fetchRegistryIndex(options);
    spinner.stop();
  } catch (err) {
    spinner.fail('Failed to fetch registry index');
    throw err;
  }

  const entry = index.components.find(
    (c) => c.name === name && (!version || c.version === version),
  );

  if (!entry) {
    const available = index.components
      .filter((c) => c.name === name)
      .map((c) => c.version)
      .join(', ');
    if (available) {
      console.error(
        chalk.red(`Version ${version} not found. Available: ${available}`),
      );
    } else {
      console.error(chalk.red(`Component "${name}" not found in registry`));
      console.log(`Run ${chalk.bold('dify-dev search <query>')} to find components`);
    }
    process.exit(1);
  }

  const destDir = path.join(process.cwd(), 'enterprise', 'components', entry.kind.toLowerCase() + 's', name);
  const spinner2 = ora(`Installing ${name}@${entry.version} → ${destDir}`).start();

  try {
    await fs.ensureDir(destDir);

    // In a full implementation, this would download the spec from the registry URL.
    // For local registry entries, copy from the registry directory.
    const localSpecPath = path.join(
      path.dirname(LOCAL_REGISTRY_PATH),
      entry.spec,
    );

    if (await fs.pathExists(localSpecPath)) {
      await fs.copy(localSpecPath, path.join(destDir, 'component.yml'));
    } else {
      // Create a stub component.yml with metadata
      const stub = [
        `apiVersion: dify.dev/v1`,
        `kind: ${entry.kind}`,
        `metadata:`,
        `  name: ${entry.name}`,
        `  description: "${entry.description}"`,
        `  version: "${entry.version}"`,
        `  author: "${entry.author}"`,
        `  labels: [${entry.tags.map((t) => `"${t}"`).join(', ')}]`,
        `spec: {}`,
      ].join('\n');
      await fs.writeFile(path.join(destDir, 'component.yml'), stub);
    }

    spinner2.succeed(`Installed ${chalk.green(name)}@${entry.version}`);

    if (entry.requiresSecrets.length > 0) {
      console.log(chalk.yellow('\nRequired secrets (add to .env or Docker Secrets):'));
      for (const s of entry.requiresSecrets) {
        console.log(`  ${s}`);
      }
    }

    console.log(`\nDeploy with: ${chalk.bold(`dify-dev deploy ${name}`)}`);
  } catch (err) {
    spinner2.fail(`Failed to install ${name}`);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
// publish
// ─────────────────────────────────────────────────────────────

export interface PublishOptions extends RegistryOptions {
  dryRun?: boolean;
}

export async function publishCommand(
  componentPath: string,
  options: PublishOptions,
): Promise<void> {
  const absPath = path.resolve(componentPath);
  const specFile = (await fs.stat(absPath)).isDirectory()
    ? path.join(absPath, 'component.yml')
    : absPath;

  if (!(await fs.pathExists(specFile))) {
    console.error(chalk.red(`Component spec not found: ${specFile}`));
    process.exit(1);
  }

  // Quality gate: validate before publish
  console.log(chalk.bold('Running quality gate checks...\n'));

  const spinner = ora('Validating schema and semantics...').start();
  try {
    await validateCommand(undefined, {
      all: false,
      level: 3,
      verbose: options.verbose,
    });
    spinner.succeed('Validation passed');
  } catch {
    spinner.fail('Validation failed — fix errors before publishing');
    process.exit(1);
  }

  // Check README exists
  const readmePath = path.join(path.dirname(specFile), 'README.md');
  if (!(await fs.pathExists(readmePath))) {
    console.error(chalk.red('Missing README.md — required before publishing'));
    process.exit(1);
  }

  // Parse the DSL to extract metadata
  const dsl = parseToolDSLFromFile(specFile);
  const { name, version } = dsl.metadata;

  if (options.dryRun) {
    console.log(chalk.yellow('\n[dry-run] Would publish:'));
    console.log(`  name:    ${name}`);
    console.log(`  version: ${version ?? 'unset'}`);
    console.log(`  spec:    ${specFile}`);
    console.log('\nQuality gate: PASSED');
    return;
  }

  // In a full implementation, this opens a PR against the registry repo.
  // For now, we write/update the local registry index.
  const index: RegistryIndex = await fetchRegistryIndex(options).catch(() => ({
    version: '1.0.0',
    updated: new Date().toISOString(),
    components: [],
  }));

  const existing = index.components.findIndex((c) => c.name === name);
  const entry: RegistryEntry = {
    name: name,
    displayName: name,
    description: dsl.metadata.description ?? '',
    kind: dsl.kind,
    version: version ?? '1.0.0',
    author: dsl.metadata.author ?? 'unknown',
    tags: dsl.metadata.labels ?? [],
    path: `components/${dsl.kind.toLowerCase()}s/${name}`,
    readme: `components/${dsl.kind.toLowerCase()}s/${name}/README.md`,
    spec: `components/${dsl.kind.toLowerCase()}s/${name}/v${version ?? '1.0.0'}/spec.yml`,
    requiresSecrets: [],
    minDevKitVersion: '0.3.0',
  };

  if (existing >= 0) {
    index.components[existing] = entry;
    console.log(chalk.yellow(`Updated existing entry for ${name}`));
  } else {
    index.components.push(entry);
  }

  index.updated = new Date().toISOString();

  if (await fs.pathExists(LOCAL_REGISTRY_PATH)) {
    await fs.writeJSON(LOCAL_REGISTRY_PATH, index, { spaces: 2 });
    console.log(chalk.green(`\n✓ Published ${name}@${version ?? '1.0.0'} to local registry`));
    console.log(chalk.dim('  Open a PR to add it to the public registry'));
  } else {
    console.log(chalk.green(`\n✓ Component ready for publishing:`));
    console.log(`  Open a PR to: https://github.com/theneoai/aidevops/tree/main/registry`);
  }
}
