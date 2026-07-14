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
  ChatStreamEvent,
  ReasoningEffort,
} from '../IProviderPlugin';
import { buildOpenAIToolsBody, parseOpenAIToolStream } from './_openaiCompat';
import type { OpenAIToolDescriptor } from './_openaiCompat';
import {
  buildOpenAIResponsesChatBody,
  buildOpenAIResponsesToolBody,
  parseOpenAIResponsesStream,
  parseOpenAIResponsesToolStream,
  usesOpenAIResponses,
} from './_openaiResponses';

const EFFORTS_BY_MODEL_FAMILY: Array<[families: string[], efforts: ReasoningEffort[]]> = [
  [
    ['o1', 'o3-mini', 'o3', 'o4-mini'],
    ['low', 'medium', 'high'],
  ],
  [['gpt-5-pro'], ['high']],
  [
    ['gpt-5.2-pro', 'gpt-5.4-pro', 'gpt-5.5-pro'],
    ['medium', 'high', 'xhigh'],
  ],
  [
    ['gpt-5.2-codex', 'gpt-5.3-codex'],
    ['low', 'medium', 'high', 'xhigh'],
  ],
  [
    ['gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
    ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  ],
  [
    ['gpt-5.2', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.5'],
    ['none', 'low', 'medium', 'high', 'xhigh'],
  ],
  [['gpt-5.1'], ['none', 'low', 'medium', 'high']],
  [
    ['gpt-5', 'gpt-5-mini', 'gpt-5-nano'],
    ['minimal', 'low', 'medium', 'high'],
  ],
];

function isModelOrSnapshot(modelId: string, model: string): boolean {
  return modelId === model || modelId.startsWith(`${model}-20`);
}

export function openAIReasoningEfforts(modelId: string): ReasoningEffort[] {
  for (const [families, efforts] of EFFORTS_BY_MODEL_FAMILY) {
    if (families.some((family) => isModelOrSnapshot(modelId, family))) return [...efforts];
  }
  return [];
}

export const openaiPlugin: IProviderPlugin = {
  id: 'openai',
  name: 'OpenAI',
  requiresApiKey: true,
  requiresBaseUrl: false,
  supportsTools: true,
  supportsOpenAIApiMode: true,
  supportsHostedWebSearch: true,

  async getModels(config: ProviderConfig): Promise<ModelInfo[]> {
    const base = config.baseUrl?.replace(/\/$/, '') || 'https://api.openai.com';
    const res = await fetch(`${base}/v1/models`, {
      headers: { Authorization: `Bearer ${config.apiKey ?? ''}` },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Array<{ id: string }> };
    return (json.data ?? [])
      .map((m) => m.id)
      .filter(
        (id) =>
          id.startsWith('gpt-') ||
          id.startsWith('o1') ||
          id.startsWith('o3') ||
          id.startsWith('o4') ||
          id.startsWith('o2'),
      )
      .sort()
      .map((id) => ({ id, label: id, reasoningEfforts: openAIReasoningEfforts(id) }));
  },

  buildRequest(messages: ChatMessage[], config: ProviderConfig, params: ChatParams): RequestSpec {
    const base = config.baseUrl?.replace(/\/$/, '') || 'https://api.openai.com';
    const systemPrompt = params.systemPrompt?.trim() ?? '';
    const filtered = messages.filter((m) => m.role !== 'system');
    const msgs = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...filtered] : filtered;

    if (usesOpenAIResponses(config)) {
      return {
        url: `${base}/v1/responses`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey ?? ''}`,
        },
        body: buildOpenAIResponsesChatBody(messages, config, params),
      };
    }

    return {
      url: `${base}/v1/chat/completions`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey ?? ''}`,
      },
      body: {
        model: params.modelId,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        ...(config.reasoningEffort && { reasoning_effort: config.reasoningEffort }),
        stream: true,
        messages: msgs.map((m) => ({ role: m.role, content: m.content })),
      },
    };
  },

  async *parseStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    config?: ProviderConfig,
  ): AsyncGenerator<ChatStreamEvent> {
    if (usesOpenAIResponses(config)) {
      yield* parseOpenAIResponsesStream(reader);
      return;
    }

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
    const base = config.baseUrl?.replace(/\/$/, '') || 'https://api.openai.com';

    if (usesOpenAIResponses(config)) {
      return {
        url: `${base}/v1/responses`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey ?? ''}`,
        },
        body: buildOpenAIResponsesToolBody(messages, config, params, tools),
      };
    }

    const body = buildOpenAIToolsBody(messages, params, tools) as Record<string, unknown>;
    if (config.reasoningEffort) body.reasoning_effort = config.reasoningEffort;
    return {
      url: `${base}/v1/chat/completions`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey ?? ''}`,
      },
      body,
    };
  },

  parseToolStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    config?: ProviderConfig,
  ): AsyncGenerator<ToolStreamEvent> {
    if (usesOpenAIResponses(config)) return parseOpenAIResponsesToolStream(reader);
    return parseOpenAIToolStream(reader);
  },
};
