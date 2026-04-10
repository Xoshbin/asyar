import type { IProviderPlugin, ModelInfo, ProviderConfig, RequestSpec, ChatParams, ChatMessage } from '../IProviderPlugin';

export const ollamaPlugin: IProviderPlugin = {
  id: 'ollama',
  name: 'Ollama (local)',
  requiresApiKey: false,
  requiresBaseUrl: true,

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
};
