import chokidar from 'chokidar';
import * as path from 'path';
import { loadConfig } from '../core/config';
import { parseToolDSLFromFile } from '../core/parser';
import { createDifyAdapter } from '../adapters';

export interface WatchOptions {
  pattern?: string;
  debounce?: number;
  verbose?: boolean;
}

export async function watchCommand(options: WatchOptions): Promise<void> {
  const config = loadConfig();
  const adapter = createDifyAdapter(config);
  await adapter.connect();

  const pattern = options.pattern ?? 'enterprise/components/**/*.yml';
  console.log(`[watch] Adapter: ${config.dify.adapter ?? 'api'}`);
  console.log(`[watch] Watching: ${pattern}`);
  console.log('[watch] Press Ctrl+C to stop.\n');

  const watcher = chokidar.watch(pattern, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: options.debounce ?? 500,
      pollInterval: 100,
    },
  });

  const deploy = async (filePath: string) => {
    const rel = path.relative(process.cwd(), filePath);
    console.log(`[watch] Changed: ${rel}`);

    try {
      const dsl = parseToolDSLFromFile(filePath);
      const result = await adapter.registerTool(dsl);
      console.log(`[watch] ✓ ${result.action}: ${result.message}`);
      if (options.verbose) {
        console.log(`[watch]   provider-id: ${result.providerId}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[watch] ✗ Failed to deploy ${rel}: ${msg}`);
    }
  };

  watcher
    .on('change', deploy)
    .on('add', deploy)
    .on('error', (err: Error) => console.error('[watch] Watcher error:', err));

  process.on('SIGINT', async () => {
    console.log('\n[watch] Shutting down...');
    await watcher.close();
    await adapter.disconnect();
    process.exit(0);
  });

  // Keep process alive
  await new Promise<never>(() => {});
}
