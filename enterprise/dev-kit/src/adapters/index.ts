import { IDifyAdapter } from './dify-adapter.interface';
import { DifyApiAdapter } from './dify-api-adapter';
import { DifyDbAdapter } from './dify-db-adapter';
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
export { DifyDbAdapter } from './dify-db-adapter';

export function createDifyAdapter(config: DevKitConfig): IDifyAdapter {
  const adapterType = config.dify.adapter ?? 'api';

  if (adapterType === 'api') {
    if (!config.dify.apiKey || !config.dify.baseUrl) {
      throw new Error(
        'adapter=api requires DIFY_API_KEY and DIFY_BASE_URL. ' +
          'Set dify.adapter=db in dify-dev.yaml to use the legacy DB adapter.'
      );
    }
    return new DifyApiAdapter(
      config.dify.baseUrl,
      config.dify.apiKey,
      undefined,  // use default DIFY_V1_PATHS
      { minVersion: config.dify.minVersion, maxVersion: config.dify.maxVersion },
    );
  }

  // @deprecated: DB adapter will be removed in v0.4.0
  console.warn(
    '[DEPRECATED] dify.adapter=db bypasses Dify API validation and will break on Dify upgrades. ' +
      'Migrate to dify.adapter=api.'
  );
  return new DifyDbAdapter(config.dify.db);
}
