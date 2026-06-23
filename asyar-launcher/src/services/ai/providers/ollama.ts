import { fetch } from '@tauri-apps/plugin-http';
import type { IProviderPlugin, ModelInfo, ProviderConfig, RequestSpec, ChatParams, ChatMessage, LoopMessage, ToolStreamEvent } from '../IProviderPlugin';
import { buildOpenAIToolsBody } from './_openaiCompat';
import type { OpenAIToolDescriptor } from './_openaiCompat';

export const ollamaPlugin: IProviderPlugin = {
  id: 'ollama',
  name: 'Ollama (local)',
  requiresApiKey: false,
  requiresBaseUrl: true,
  supportsTools: true,

  async getModels(config: ProviderConfig): Promise<ModelInfo[]> {
    const base = config.baseUrl?.replace(/\/$/, '') || 'http://localhost:11434';
    try {
      const res = await fetch(`${base}/api/tags`);
      if (!res.ok) return [];
      const json = await res.json() as { models?: Array<{ name: string }> };
      return (json.models ?? []).map((m) => ({ id: m.name, label: m.name }));
    } catch {
      return [];
    }
  },

  buildRequest(messages: ChatMessage[], config: ProviderConfig, params: ChatParams): RequestSpec {
    const base = config.baseUrl?.replace(/\/$/, '') || 'http://localhost:11434';
    const systemPrompt = params.systemPrompt?.trim() ?? '';
    const filtered = messages.filter((m) => m.role !== 'system');
    const msgs = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...filtered]
      : filtered;
    return {
      url: `${base}/api/chat`,
      headers: { 'Content-Type': 'application/json' },
      body: {
        model: params.modelId,
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
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          const token = json.message?.content;
          if (token) yield token;
          if (json.done) return;
        } catch { /* skip malformed lines */ }
      }
    }
  },

  buildToolRequest(
    messages: LoopMessage[],
    config: ProviderConfig,
    params: ChatParams,
    tools: OpenAIToolDescriptor[],
  ): RequestSpec {
    const base = config.baseUrl?.replace(/\/$/, '') || 'http://localhost:11434';
    const body = buildOpenAIToolsBody(messages, params, tools);
    return {
      // Ollama uses /api/chat, not /v1/chat/completions
      url: `${base}/api/chat`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
  },

  async *parseToolStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<ToolStreamEvent> {
    const decoder = new TextDecoder();
    let buffer = '';
    let toolCounter = 0;
    let done = false;
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let parsed: any;
        try { parsed = JSON.parse(line); } catch { continue; }
        const message = parsed?.message;
        if (typeof message?.content === 'string' && message.content !== '') {
          yield { type: 'text', text: message.content };
        }
        if (Array.isArray(message?.tool_calls)) {
          for (const tc of message.tool_calls) {
            const name = tc?.function?.name;
            // Ollama emits arguments as a JSON object, not a stringified JSON like OpenAI — pass through unchanged
            const input = tc?.function?.arguments;
            if (typeof name !== 'string') continue;
            toolCounter += 1;
            yield {
              type: 'tool_use',
              id: `ollama-${toolCounter}`,
              name,
              input: input ?? {},
            };
          }
        }
        if (parsed?.done === true) {
          done = true;
          break;
        }
      }
    }
    yield { type: 'message_stop' };
  },
};
