import axios from 'axios';

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface LLMAdapter {
  complete(prompt: string, options?: CompletionOptions): Promise<string>;
}

export class LocalLLMAdapter implements LLMAdapter {
  private baseUrl: string;
  private model: string;

  constructor() {
    this.baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
    this.model = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    const response = await axios.post(
      `${this.baseUrl}/api/generate`,
      {
        model: this.model,
        prompt,
        stream: false,
        options: { temperature: options?.temperature ?? 0 },
      },
      { timeout: 60_000 }
    );
    return response.data.response as string;
  }
}

export class OpenAIAdapter implements LLMAdapter {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY ?? '';
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY is required when USE_LOCAL_LLM is not set');
    }
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 1024,
      },
      {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        timeout: 30_000,
      }
    );
    return response.data.choices[0].message.content as string;
  }
}

/**
 * Returns LocalLLMAdapter when USE_LOCAL_LLM=true (CI / offline dev).
 * Falls back to OpenAIAdapter in production.
 */
export function createLLMAdapter(): LLMAdapter {
  if (process.env.USE_LOCAL_LLM === 'true') {
    return new LocalLLMAdapter();
  }
  return new OpenAIAdapter();
}
