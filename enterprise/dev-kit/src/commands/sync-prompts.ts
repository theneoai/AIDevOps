import * as fs from 'fs';
import * as yaml from 'yaml';
import { Langfuse } from 'langfuse';

export interface SyncPromptsOptions {
  dryRun?: boolean;
  verbose?: boolean;
}

function createLangfuseClient(): Langfuse {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const baseUrl = process.env.LANGFUSE_HOST ?? 'http://localhost:3002';

  if (!publicKey || !secretKey) {
    throw new Error(
      'LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set. ' +
        'Run `make observability-up` and create API keys in the Langfuse UI.'
    );
  }

  return new Langfuse({ publicKey, secretKey, baseUrl });
}

/**
 * Syncs prompt versions from Langfuse into YAML component DSL files.
 * Finds all nodes with a `promptRef` field and replaces the prompt text
 * with the latest published version from Langfuse.
 *
 * Usage: dify-dev sync-prompts enterprise/components/my-agent.yml
 */
export async function syncPromptsCommand(
  componentPath: string,
  options: SyncPromptsOptions = {}
): Promise<void> {
  if (!fs.existsSync(componentPath)) {
    throw new Error(`Component file not found: ${componentPath}`);
  }

  const langfuse = createLangfuseClient();
  const raw = fs.readFileSync(componentPath, 'utf-8');
  const dsl = yaml.parse(raw);
  let synced = 0;

  const processNodes = async (nodes: unknown[]): Promise<void> => {
    for (const node of nodes) {
      const n = node as Record<string, unknown>;
      if (n.type === 'llm' && n.data && (n.data as Record<string, unknown>).promptRef) {
        const ref = (n.data as Record<string, unknown>).promptRef as string;
        try {
          const prompt = await langfuse.getPrompt(ref);
          (n.data as Record<string, unknown>).prompt = prompt.prompt;
          console.log(
            `  ✓ Synced '${ref}' (v${prompt.version})${options.dryRun ? ' [dry-run]' : ''}`
          );
          synced++;
        } catch (err) {
          console.warn(`  ✗ Could not fetch prompt '${ref}': ${(err as Error).message}`);
        }
      }
    }
  };

  if (Array.isArray(dsl.nodes)) {
    await processNodes(dsl.nodes);
  }

  if (synced === 0) {
    console.log('No promptRef nodes found in this component.');
    return;
  }

  if (!options.dryRun) {
    fs.writeFileSync(componentPath, yaml.stringify(dsl), 'utf-8');
    console.log(`\nUpdated ${componentPath} with ${synced} synced prompt(s).`);
  } else {
    console.log(`\n[dry-run] Would update ${synced} prompt(s) in ${componentPath}`);
  }

  await langfuse.shutdownAsync();
}
