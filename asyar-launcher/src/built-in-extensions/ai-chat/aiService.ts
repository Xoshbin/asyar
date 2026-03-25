import type { AIMessage, AISettings } from './aiStore';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StreamHandlers {
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

// ─── Provider Endpoint Helpers ────────────────────────────────────────────────

function getEndpoint(settings: AISettings): string {
  switch (settings.provider) {
    case 'openai':
      return 'https://api.openai.com/v1/chat/completions';
    case 'anthropic':
      return 'https://api.anthropic.com/v1/messages';
    case 'google':
      return `https://generativelanguage.googleapis.com/v1beta/models/${settings.model}:streamGenerateContent?alt=sse&key=${settings.apiKey}`;
    case 'ollama':
      return `${settings.baseUrl ?? 'http://localhost:11434'}/api/chat`;
    case 'openrouter':
      return 'https://openrouter.ai/api/v1/chat/completions';
    case 'custom':
      return `${settings.baseUrl ?? ''}/v1/chat/completions`;
  }
}

function getHeaders(settings: AISettings): Record<string, string> {
  const base: Record<string, string> = { 'Content-Type': 'application/json' };
  switch (settings.provider) {
    case 'openai':
    case 'openrouter':
    case 'custom':
      return { ...base, Authorization: `Bearer ${settings.apiKey}` };
    case 'anthropic':
      return { ...base, 'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01' };
    case 'google':
      return base; // key is in URL
    case 'ollama':
      return base;
  }
}

function buildBody(messages: AIMessage[], settings: AISettings): unknown {
  const systemPrompt = settings.systemPrompt?.trim() ?? '';
  const filteredMessages = messages.filter(m => m.role !== 'system');

  if (settings.provider === 'anthropic') {
    return {
      model: settings.model,
      max_tokens: settings.maxTokens,
      temperature: settings.temperature,
      system: systemPrompt || 'You are a helpful assistant.',
      stream: true,
      messages: filteredMessages.map(m => ({ role: m.role, content: m.content })),
    };
  }

  if (settings.provider === 'google') {
    const contents = filteredMessages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    return {
      contents,
      generationConfig: {
        temperature: settings.temperature,
        maxOutputTokens: settings.maxTokens,
      },
    };
  }

  // OpenAI-compatible (openai, ollama, openrouter, custom)
  const msgs = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...filteredMessages]
    : filteredMessages;
  return {
    model: settings.model,
    max_tokens: settings.maxTokens,
    temperature: settings.temperature,
    stream: true,
    messages: msgs.map(m => ({ role: m.role, content: m.content })),
  };
}

// ─── Token Parsing ────────────────────────────────────────────────────────────

function extractToken(line: string, provider: AISettings['provider']): string | null {
  if (!line.startsWith('data: ')) return null;
  const data = line.slice(6).trim();
  if (data === '[DONE]') return null;

  try {
    const json = JSON.parse(data);
    if (provider === 'anthropic') {
      if (json.type === 'content_block_delta') return json.delta?.text ?? null;
      return null;
    }
    if (provider === 'google') {
      return json.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    }
    // OpenAI-compatible (openrouter included)
    return json.choices?.[0]?.delta?.content ?? null;
  } catch {
    return null;
  }
}

// ─── Main stream function ─────────────────────────────────────────────────────

let abortController: AbortController | null = null;

export function stopStream(): void {
  abortController?.abort();
  abortController = null;
}

export async function streamChat(
  messages: AIMessage[],
  settings: AISettings,
  handlers: StreamHandlers
): Promise<void> {
  // Abort any previous request
  stopStream();
  abortController = new AbortController();
  const signal = abortController.signal;

  const url = getEndpoint(settings);
  const headers = getHeaders(settings);
  const body = buildBody(messages, settings);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => `HTTP ${response.status}`);
      let friendlyError: string;
      try {
        const errJson = JSON.parse(errorText);
        friendlyError = errJson.error?.message ?? errJson.message ?? errorText;
      } catch {
        friendlyError = errorText || `HTTP ${response.status}`;
      }
      handlers.onError(`API error: ${friendlyError}`);
      return;
    }

    if (!response.body) {
      handlers.onError('No response body received.');
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Ollama non-streaming: just read JSON
    if (settings.provider === 'ollama') {
      let fullText = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            const token = json.message?.content ?? '';
            if (token) {
              handlers.onToken(token);
              fullText += token;
            }
            if (json.done) {
              handlers.onDone();
              return;
            }
          } catch { /* ignore malformed lines */ }
        }
      }
      handlers.onDone();
      return;
    }

    // SSE streaming for all other providers
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const token = extractToken(line.trim(), settings.provider);
        if (token !== null) {
          handlers.onToken(token);
        }
      }
    }

    if (!signal.aborted) {
      handlers.onDone();
    }
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') {
      // User stopped the generation — treat as done
      handlers.onDone();
    } else {
      handlers.onError((err as Error)?.message ?? 'Unknown error');
    }
  } finally {
    abortController = null;
  }
}
