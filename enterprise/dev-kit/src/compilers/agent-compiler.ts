/**
 * P5-3b: Agent DSL Compiler
 *
 * Translates the DevKit AgentDSL (YAML) into a Dify Agent App JSON
 * ready to POST to /v1/apps.
 *
 * Supported strategies:
 *   - type: react         → Dify agent_thought mode (ReAct loop)
 *   - type: plan-execute  → Dify workflow app with planning nodes
 */

import { AgentDSL, AgentSpec, AgentToolBinding, AgentGuardrail } from '../types/dsl';

// ─────────────────────────────────────────────────────────────
// Dify Agent App Payload
// ─────────────────────────────────────────────────────────────

export interface DifyAgentPayload {
  name: string;
  description: string;
  mode: 'agent-chat';
  icon_type: 'emoji';
  icon: string;
  model_config: {
    provider: string;
    model: string;
    mode: string;
    completion_params: Record<string, unknown>;
    pre_prompt: string;
    agent_mode: {
      enabled: true;
      strategy: 'react' | 'function-call';
      max_iteration: number;
      tools: Array<{
        provider_id: string;
        provider_type: string;
        provider_name: string;
        tool_name: string;
        tool_label: string;
        enabled: boolean;
      }>;
    };
    memory: {
      enabled: boolean;
      window: { enabled: boolean; size: number };
    };
    opening_statement: string;
    suggested_questions: string[];
  };
  features: {
    sensitive_word_avoidance: { enabled: boolean };
    speech_to_text: { enabled: boolean };
    text_to_speech: { enabled: boolean };
    file_upload: { enabled: boolean };
    citation: { enabled: boolean };
  };
}

// ─────────────────────────────────────────────────────────────
// Compiler
// ─────────────────────────────────────────────────────────────

export class AgentCompiler {
  private toolRefMap: Map<string, string> = new Map();

  setToolRefMap(map: Map<string, string>): void {
    this.toolRefMap = map;
  }

  compile(dsl: AgentDSL): DifyAgentPayload {
    const spec = dsl.spec;
    return {
      name: dsl.metadata.name,
      description: dsl.metadata.description ?? '',
      mode: 'agent-chat',
      icon_type: 'emoji',
      icon: dsl.metadata.icon ?? '🤖',
      model_config: {
        provider: spec.model?.provider ?? 'openai',
        model: spec.model?.name ?? 'gpt-4o',
        mode: 'chat',
        completion_params: {
          temperature: spec.model?.temperature ?? 0.7,
          max_tokens: spec.model?.maxTokens ?? 4096,
        },
        pre_prompt: spec.systemPrompt,
        agent_mode: {
          enabled: true,
          strategy: 'react',
          max_iteration: spec.maxIterations ?? 10,
          tools: this.compileTools(spec.tools ?? []),
        },
        memory: {
          enabled: (spec.memory?.type ?? 'conversation') !== 'none',
          window: {
            enabled: spec.memory?.windowSize !== undefined,
            size: spec.memory?.windowSize ?? 10,
          },
        },
        opening_statement: spec.openingStatement ?? '',
        suggested_questions: spec.suggestedQuestions ?? [],
      },
      features: {
        sensitive_word_avoidance: {
          enabled: this.hasGuardrail(spec.guardrails, 'content_filter'),
        },
        speech_to_text: { enabled: false },
        text_to_speech: { enabled: false },
        file_upload: { enabled: false },
        citation: { enabled: true },
      },
    };
  }

  private compileTools(
    tools: AgentToolBinding[],
  ): DifyAgentPayload['model_config']['agent_mode']['tools'] {
    return tools.map((t) => {
      const ref = t.ref.startsWith('ref:') ? t.ref.slice(4) : t.ref;
      const [providerName, toolName] = ref.split('.');
      const providerId = this.toolRefMap.get(t.ref) ?? providerName;

      return {
        provider_id: providerId,
        provider_type: t.ref.startsWith('builtin:') ? 'builtin' : 'api',
        provider_name: providerName,
        tool_name: toolName ?? providerName,
        tool_label: t.name ?? toolName ?? providerName,
        enabled: true,
      };
    });
  }

  private hasGuardrail(
    guardrails: AgentGuardrail[] | undefined,
    type: AgentGuardrail['type'],
  ): boolean {
    return guardrails?.some((g) => g.type === type) ?? false;
  }
}

export function compileAgent(dsl: AgentDSL, toolRefMap?: Map<string, string>): DifyAgentPayload {
  const compiler = new AgentCompiler();
  if (toolRefMap) compiler.setToolRefMap(toolRefMap);
  return compiler.compile(dsl);
}
