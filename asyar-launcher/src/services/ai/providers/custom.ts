import type { IProviderPlugin, ModelInfo, ProviderConfig, RequestSpec, ChatParams, ChatMessage } from '../IProviderPlugin';

export const customPlugin: IProviderPlugin = {
  id: 'custom',
  name: 'Custom (OpenAI-compatible)',
  requiresApiKey: false,
  requiresBaseUrl: true,

  async getModels(config: ProviderConfig): Promise<ModelInfo[]> {
    if (!config.baseUrl) return [];
    const base = config.baseUrl.replace(/\/$/, '');
    try {
      const headers: Record<string, string> = {};
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
      const res = await fetch(`${base}/v1/models`, { headers });
      if (!res.ok) return [];
      const json = await res.json() as { data?: Array<{ id: string }> };
      return (json.data ?? []).map((m) => ({ id: m.id, label: m.id }));
    } catch {
      // Endpoint may not exist — user types model manually
      return [];
    }
  },

  buildRequest(messages: ChatMessage[], config: ProviderConfig, params: ChatParams): RequestSpec {
    const base = (config.baseUrl ?? '').replace(/\/$/, '');
    const systemPrompt = params.systemPrompt?.trim() ?? '';
    const filtered = messages.filter((m) => m.role !== 'system');
    const msgs = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...filtered]
      : filtered;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    return {
      url: `${base}/v1/chat/completions`,
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
};
