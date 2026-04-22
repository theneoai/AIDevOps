import { IDifyAdapter } from './dify-adapter.interface';
import { DifyApiAdapter } from './dify-api-adapter';
import { DevKitConfig } from '../core/config';

export {
  IDifyAdapter,
  ToolRegistrationResult,
  ProviderStatus,
  WorkflowRunResult,
  WorkflowRunOptions,
  McpServerInfo,
  PluginInstallResult,
  DifyApiNotAvailableError,
  DifyVersionMismatchError,
} from './dify-adapter.interface';
export { DifyApiAdapter } from './dify-api-adapter';

export function createDifyAdapter(config: DevKitConfig): IDifyAdapter {
  const adapterType = config.dify.adapter ?? 'api';

  if (adapterType === 'db') {
    throw new Error(
      '[REMOVED] dify.adapter=db was removed in v0.4.0. ' +
        'The direct PostgreSQL adapter bypassed Dify API validation and broke on every schema upgrade. ' +
        'Set dify.adapter=api (default) and provide DIFY_API_KEY + DIFY_BASE_URL.'
    );
  }

  if (!config.dify.apiKey || !config.dify.baseUrl) {
    throw new Error(
      'adapter=api requires DIFY_API_KEY and DIFY_BASE_URL. ' +
        'Add them to dify-dev.yaml or set them as environment variables.'
    );
  }

  return new DifyApiAdapter(
    config.dify.baseUrl,
    config.dify.apiKey,
    undefined,
    { minVersion: config.dify.minVersion, maxVersion: config.dify.maxVersion },
  );
}
