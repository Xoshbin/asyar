import type { IProviderPlugin, ModelInfo, ProviderConfig, RequestSpec, ChatParams, ChatMessage } from '../IProviderPlugin';

export const openaiPlugin: IProviderPlugin = {
  id: 'openai',
  name: 'OpenAI',
  requiresApiKey: true,
  requiresBaseUrl: false,

  async getModels(config: ProviderConfig): Promise<ModelInfo[]> {
    const base = config.baseUrl?.replace(/\/$/, '') || 'https://api.openai.com';
    const res = await fetch(`${base}/v1/models`, {
      headers: { Authorization: `Bearer ${config.apiKey ?? ''}` },
    });
    if (!res.ok) return [];
    const json = await res.json() as { data?: Array<{ id: string }> };
    return (json.data ?? [])
      .map((m) => m.id)
      .filter((id) => id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4') || id.startsWith('o2'))
      .sort()
      .map((id) => ({ id, label: id }));
  },

  buildRequest(messages: ChatMessage[], config: ProviderConfig, params: ChatParams): RequestSpec {
    const base = config.baseUrl?.replace(/\/$/, '') || 'https://api.openai.com';
    const systemPrompt = params.systemPrompt?.trim() ?? '';
    const filtered = messages.filter((m) => m.role !== 'system');
    const msgs = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...filtered]
      : filtered;
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
