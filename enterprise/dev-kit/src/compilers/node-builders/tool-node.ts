import { ToolStepConfig } from '../../types/dsl';

export interface DifyToolNode {
  id: string;
  type: 'tool';
  data: {
    title: string;
    provider_id: string;
    provider_type: 'api' | 'mcp' | 'builtin';
    provider_name: string;
    tool_name: string;
    tool_label: string;
    tool_configurations: Record<string, unknown>;
    tool_parameters: Record<string, { type: string; value: unknown }>;
  };
  position: { x: number; y: number };
}

export function buildToolNode(
  id: string,
  name: string,
  config: ToolStepConfig,
  position: { x: number; y: number },
  resolvedProviderId: string,
): DifyToolNode {
  const [providerName, toolName] = config.tool.startsWith('ref:')
    ? config.tool.slice(4).split('.')
    : ['builtin', config.tool.replace('builtin:', '')];

  const toolParameters: Record<string, { type: string; value: unknown }> = {};
  for (const [key, val] of Object.entries(config.inputs)) {
    toolParameters[key] = {
      type: val.startsWith('{{') ? 'variable' : 'static',
      value: val,
    };
  }

  return {
    id,
    type: 'tool',
    data: {
      title: name,
      provider_id: resolvedProviderId,
      provider_type: config.tool.startsWith('builtin:') ? 'builtin' : 'api',
      provider_name: providerName,
      tool_name: toolName ?? providerName,
      tool_label: name,
      tool_configurations: {},
      tool_parameters: toolParameters,
    },
    position,
  };
}
