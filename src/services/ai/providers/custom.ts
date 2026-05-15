import type { IProviderPlugin, ModelInfo, ProviderConfig, RequestSpec, ChatParams, ChatMessage, LoopMessage, ToolStreamEvent } from '../IProviderPlugin';
import { buildOpenAIToolsBody, parseOpenAIToolStream } from './_openaiCompat';
import type { OpenAIToolDescriptor } from './_openaiCompat';

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

export const customPlugin: IProviderPlugin = {
  id: 'custom',
  name: 'Custom (OpenAI-compatible)',
  requiresApiKey: false,
  optionalApiKey: true,
  requiresBaseUrl: true,
  supportsTools: true,

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
      const json = await res.json() as { data?: Array<{ id: string }> };
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
    const msgs = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...filtered]
      : filtered;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // Required when the user points Custom at Anthropic's OpenAI-compat endpoint;
      // ignored by every other OpenAI-compatible provider.
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    return {
      url: `${base}/chat/completions`,
      headers,
      body: {
        model: params.modelId,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
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
        } catch { /* skip malformed */ }
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
    const body = buildOpenAIToolsBody(messages, params, tools);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // Required when the user points Custom at Anthropic's OpenAI-compat endpoint;
      // ignored by every other OpenAI-compatible provider.
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    return {
      url: `${base}/chat/completions`,
      headers,
      body: JSON.stringify(body),
    };
  },

  parseToolStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<ToolStreamEvent> {
    return parseOpenAIToolStream(reader);
  },
};
