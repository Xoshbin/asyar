import { fetch } from '@tauri-apps/plugin-http';
import type {
  IProviderPlugin,
  ModelInfo,
  ProviderConfig,
  RequestSpec,
  ChatParams,
  ChatMessage,
  LoopMessage,
  ToolStreamEvent,
  ReasoningEffort,
} from '../IProviderPlugin';
import { buildOpenAIToolsBody, parseOpenAIToolStream } from './openaiCompat';
import type { OpenAIToolDescriptor } from './openaiCompat';

const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return REASONING_EFFORTS.includes(value as ReasoningEffort);
}

function supportedReasoningEfforts(values: unknown[] | null | undefined): ReasoningEffort[] {
  if (values === null) return [...REASONING_EFFORTS];
  const supported = new Set((values ?? []).filter(isReasoningEffort));
  return REASONING_EFFORTS.filter((effort) => supported.has(effort));
}

export const openrouterPlugin: IProviderPlugin = {
  id: 'openrouter',
  name: 'OpenRouter',
  requiresApiKey: true,
  requiresBaseUrl: false,
  supportsTools: true,
  reasoningEfforts: REASONING_EFFORTS,

  async getModels(config: ProviderConfig): Promise<ModelInfo[]> {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        Authorization: `Bearer ${config.apiKey ?? ''}`,
        'HTTP-Referer': 'https://asyar.app',
        'X-Title': 'Asyar',
      },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: Array<{
        id: string;
        name?: string;
        reasoning?: { supported_efforts?: unknown[] | null };
      }>;
    };
    return (json.data ?? []).map((m) => ({
      id: m.id,
      label: m.name ?? m.id,
      reasoningEfforts: supportedReasoningEfforts(m.reasoning?.supported_efforts),
    }));
  },

  buildRequest(messages: ChatMessage[], config: ProviderConfig, params: ChatParams): RequestSpec {
    const systemPrompt = params.systemPrompt?.trim() ?? '';
    const filtered = messages.filter((m) => m.role !== 'system');
    const msgs = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...filtered] : filtered;
    return {
      url: 'https://openrouter.ai/api/v1/chat/completions',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey ?? ''}`,
        'HTTP-Referer': 'https://asyar.app',
        'X-Title': 'Asyar',
      },
      body: {
        model: params.modelId,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        ...(config.reasoningEffort && {
          reasoning: { effort: config.reasoningEffort },
        }),
        stream: true,
        messages: msgs.map((m) => ({ role: m.role, content: m.content })),
      },
    };
  },

  async *parseStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<string> {
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          const json = JSON.parse(data);
          const token = json.choices?.[0]?.delta?.content;
          if (token) yield token;
        } catch {
          /* skip malformed */
        }
      }
    }
  },

  buildToolRequest(
    messages: LoopMessage[],
    config: ProviderConfig,
    params: ChatParams,
    tools: OpenAIToolDescriptor[],
  ): RequestSpec {
    const body = buildOpenAIToolsBody(messages, params, tools) as Record<string, unknown>;
    if (config.reasoningEffort) body.reasoning = { effort: config.reasoningEffort };
    return {
      url: 'https://openrouter.ai/api/v1/chat/completions',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey ?? ''}`,
        'HTTP-Referer': 'https://asyar.app',
        'X-Title': 'Asyar',
      },
      body,
    };
  },

  parseToolStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): AsyncGenerator<ToolStreamEvent> {
    return parseOpenAIToolStream(reader);
  },
};
