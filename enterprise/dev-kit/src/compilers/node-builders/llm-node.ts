import { LLMStepConfig } from '../../types/dsl';

export interface DifyLLMNode {
  id: string;
  type: 'llm';
  data: {
    title: string;
    model: { provider: string; name: string; mode: string; completion_params: Record<string, unknown> };
    prompt_template: Array<{ role: string; text: string }>;
    variables: string[];
    context: { enabled: boolean };
    vision: { enabled: boolean };
  };
  position: { x: number; y: number };
}

export function buildLLMNode(
  id: string,
  name: string,
  config: LLMStepConfig,
  position: { x: number; y: number },
): DifyLLMNode {
  const provider = config.provider ?? 'openai';
  const model = config.model ?? 'gpt-4o';

  return {
    id,
    type: 'llm',
    data: {
      title: name,
      model: {
        provider,
        name: model,
        mode: 'chat',
        completion_params: {
          temperature: config.temperature ?? 0.7,
          max_tokens: config.maxTokens ?? 2048,
        },
      },
      prompt_template: [
        ...(config.systemPrompt
          ? [{ role: 'system', text: config.systemPrompt }]
          : []),
        { role: 'user', text: config.prompt },
      ],
      variables: extractVariables(config.prompt),
      context: { enabled: false },
      vision: { enabled: false },
    },
    position,
  };
}

function extractVariables(template: string): string[] {
  const matches = template.match(/\{\{([^}]+)\}\}/g) ?? [];
  return [...new Set(matches.map((m) => m.replace(/^\{\{|\}\}$/g, '').trim()))];
}
