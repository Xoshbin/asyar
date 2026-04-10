import type { IProviderPlugin, ModelInfo, ProviderConfig, RequestSpec, ChatParams, ChatMessage } from '../IProviderPlugin';

export const anthropicPlugin: IProviderPlugin = {
  id: 'anthropic',
  name: 'Anthropic',
  requiresApiKey: true,
  requiresBaseUrl: false,

  async getModels(config: ProviderConfig): Promise<ModelInfo[]> {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: {
        'x-api-key': config.apiKey ?? '',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });
    if (!res.ok) return [];
    const json = await res.json() as { data?: Array<{ id: string; display_name?: string }> };
    return (json.data ?? []).map((m) => ({ id: m.id, label: m.display_name ?? m.id }));
  },

  buildRequest(messages: ChatMessage[], config: ProviderConfig, params: ChatParams): RequestSpec {
    const systemPrompt = params.systemPrompt?.trim() || 'You are a helpful assistant.';
    const filtered = messages.filter((m) => m.role !== 'system');
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey ?? '',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: {
        model: params.modelId,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        system: systemPrompt,
        stream: true,
        messages: filtered.map((m) => ({ role: m.role, content: m.content })),
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
        try {
          const json = JSON.parse(data);
          if (json.type === 'content_block_delta') {
            const token = json.delta?.text;
            if (token) yield token;
          }
        } catch { /* skip malformed */ }
      }
    }
  },
};
