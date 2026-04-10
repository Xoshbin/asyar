import type { IProviderPlugin, ModelInfo, ProviderConfig, RequestSpec, ChatParams, ChatMessage } from '../IProviderPlugin';

export const googlePlugin: IProviderPlugin = {
  id: 'google',
  name: 'Google Gemini',
  requiresApiKey: true,
  requiresBaseUrl: false,

  async getModels(config: ProviderConfig): Promise<ModelInfo[]> {
    // Security fix: API key in Authorization header, NOT in URL
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: {
        'x-goog-api-key': config.apiKey ?? '',
      },
    });
    if (!res.ok) return [];
    const json = await res.json() as { models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }> };
    return (json.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .filter((m) => m.name.includes('gemini'))
      .map((m) => ({
        id: m.name.replace('models/', ''),
        label: m.displayName ?? m.name.replace('models/', ''),
      }));
  },

  buildRequest(messages: ChatMessage[], config: ProviderConfig, params: ChatParams): RequestSpec {
    const filtered = messages.filter((m) => m.role !== 'system');
    const contents = filtered.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${params.modelId}:streamGenerateContent?alt=sse`,
      headers: {
        'Content-Type': 'application/json',
        // API key in header, not URL (security fix)
        'x-goog-api-key': config.apiKey ?? '',
      },
      body: {
        contents,
        generationConfig: {
          temperature: params.temperature,
          maxOutputTokens: params.maxTokens,
        },
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
          const token = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (token) yield token;
        } catch { /* skip malformed */ }
      }
    }
  },
};
