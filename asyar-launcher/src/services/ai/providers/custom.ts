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
} from '../IProviderPlugin';
import { buildOpenAIToolsBody, parseOpenAIToolStream } from './_openaiCompat';
import type { OpenAIToolDescriptor } from './_openaiCompat';
import {
  HOSTED_WEB_SEARCH_TOOL,
  buildOpenAIResponsesChatBody,
  buildOpenAIResponsesToolBody,
  parseOpenAIResponsesStream,
  parseOpenAIResponsesToolStream,
  usesOpenAIResponses,
} from './_openaiResponses';

/**
 * Normalise the user-supplied base URL so the same launcher works whether the
 * user pasted `https://api.example.com` or `https://api.example.com/v1` (or
 * Google's Gemini OpenAI-compat shim at `…/v1beta/openai`). Returns the prefix
 * that the chat/completions and models endpoints should be appended to.
 */
function normalizeOpenAIBase(rawBase: string): string {
  const trimmed = rawBase.replace(/\/+$/, '');
  // Already versioned (/v1, /v2, …) or Gemini's /openai compat suffix → keep as-is.
  if (/\/v\d+(\/|$)|\/openai$/.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

function withHostedWebSearch(body: Record<string, unknown>, config: ProviderConfig) {
  if (!config.hostedWebSearch) return body;
  const existingTools = Array.isArray(body.tools) ? body.tools : [];
  return {
    ...body,
    tools: [...existingTools, HOSTED_WEB_SEARCH_TOOL],
  };
}

export const customPlugin: IProviderPlugin = {
  id: 'custom',
  name: 'Custom (OpenAI-compatible)',
  requiresApiKey: false,
  optionalApiKey: true,
  requiresBaseUrl: true,
  supportsTools: true,
  supportsOpenAIApiMode: true,
  supportsHostedWebSearch: true,
  reasoningEfforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],

  async getModels(config: ProviderConfig): Promise<ModelInfo[]> {
    if (!config.baseUrl) return [];
    const base = normalizeOpenAIBase(config.baseUrl);
    try {
      const headers: Record<string, string> = {
        'anthropic-dangerous-direct-browser-access': 'true',
      };
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
      const res = await fetch(`${base}/models`, { headers });
      if (!res.ok) return [];
      const json = (await res.json()) as { data?: Array<{ id: string }> };
      return (json.data ?? []).map((m) => ({ id: m.id, label: m.id }));
    } catch {
      // Endpoint may not exist — user types model manually
      return [];
    }
  },

  buildRequest(messages: ChatMessage[], config: ProviderConfig, params: ChatParams): RequestSpec {
    const base = normalizeOpenAIBase(config.baseUrl ?? '');
    const systemPrompt = params.systemPrompt?.trim() ?? '';
    const filtered = messages.filter((m) => m.role !== 'system');
    const msgs = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...filtered] : filtered;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // Required when the user points Custom at Anthropic's OpenAI-compat endpoint;
      // ignored by every other OpenAI-compatible provider.
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

    if (usesOpenAIResponses(config)) {
      return {
        url: `${base}/responses`,
        headers,
        body: buildOpenAIResponsesChatBody(messages, config, params),
      };
    }

    const body = withHostedWebSearch(
      {
        model: params.modelId,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        ...(config.reasoningEffort && { reasoning_effort: config.reasoningEffort }),
        stream: true,
        messages: msgs.map((m) => ({ role: m.role, content: m.content })),
      },
      config,
    );
    return {
      url: `${base}/chat/completions`,
      headers,
      body,
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
    const base = normalizeOpenAIBase(config.baseUrl ?? '');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // Required when the user points Custom at Anthropic's OpenAI-compat endpoint;
      // ignored by every other OpenAI-compatible provider.
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

    if (usesOpenAIResponses(config)) {
      return {
        url: `${base}/responses`,
        headers,
        body: buildOpenAIResponsesToolBody(messages, config, params, tools),
      };
    }

    const compatibleBody = buildOpenAIToolsBody(messages, params, tools) as Record<string, unknown>;
    if (config.reasoningEffort) compatibleBody.reasoning_effort = config.reasoningEffort;
    const body = withHostedWebSearch(compatibleBody, config);
    return {
      url: `${base}/chat/completions`,
      headers,
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
