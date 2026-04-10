import type { IProviderPlugin, ModelInfo, ProviderConfig, RequestSpec, ChatParams, ChatMessage } from '../IProviderPlugin';

export const openrouterPlugin: IProviderPlugin = {
  id: 'openrouter',
  name: 'OpenRouter',
  requiresApiKey: true,
  requiresBaseUrl: false,

  async getModels(config: ProviderConfig): Promise<ModelInfo[]> {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        Authorization: `Bearer ${config.apiKey ?? ''}`,
        'HTTP-Referer': 'https://asyar.app',
        'X-Title': 'Asyar',
      },
    });
    if (!res.ok) return [];
    const json = await res.json() as { data?: Array<{ id: string; name?: string }> };
    return (json.data ?? []).map((m) => ({
      id: m.id,
      label: m.name ?? m.id,
    }));
  },

  buildRequest(messages: ChatMessage[], config: ProviderConfig, params: ChatParams): RequestSpec {
    const systemPrompt = params.systemPrompt?.trim() ?? '';
    const filtered = messages.filter((m) => m.role !== 'system');
    const msgs = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...filtered]
      : filtered;
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
