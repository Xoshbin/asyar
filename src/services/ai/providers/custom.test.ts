import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { customPlugin } from './custom';
import type { ChatMessage, ChatParams, ProviderConfig, LoopMessage } from '../IProviderPlugin';

const baseParams: ChatParams = {
  modelId: 'local-model',
  temperature: 0.5,
  maxTokens: 1024,
};

const userMsg: ChatMessage = {
  id: 'm1',
  role: 'user',
  content: 'hello',
  timestamp: 0,
};

describe('customPlugin metadata', () => {
  it('exposes optionalApiKey: true so the UI renders the key field for the Custom provider', () => {
    expect(customPlugin.optionalApiKey).toBe(true);
  });

  it('keeps requiresApiKey: false so unsecured local endpoints (LocalAI, Ollama-compatible) still pass the hasCredentials gate', () => {
    expect(customPlugin.requiresApiKey).toBe(false);
  });
});

describe('customPlugin.buildRequest', () => {
  it('adds Authorization: Bearer <key> when an apiKey is configured', () => {
    const config: ProviderConfig = {
      enabled: true,
      baseUrl: 'https://my-llm.example/api',
      apiKey: 'sk-secret',
    };

    const spec = customPlugin.buildRequest([userMsg], config, baseParams);

    expect(spec.headers.Authorization).toBe('Bearer sk-secret');
    expect(spec.headers['Content-Type']).toBe('application/json');
    expect(spec.url).toBe('https://my-llm.example/api/v1/chat/completions');
  });

  // Real-world base-URL ergonomics — users paste these straight from provider docs.
  it.each([
    ['bare host (no version)', 'https://example.com', 'https://example.com/v1/chat/completions'],
    ['trailing slash', 'https://example.com/', 'https://example.com/v1/chat/completions'],
    ['ollama localhost', 'http://localhost:11434', 'http://localhost:11434/v1/chat/completions'],
    ['openrouter with /v1 (must NOT double-up)', 'https://openrouter.ai/api/v1', 'https://openrouter.ai/api/v1/chat/completions'],
    ['anthropic with /v1', 'https://api.anthropic.com/v1', 'https://api.anthropic.com/v1/chat/completions'],
    ['gemini /v1beta/openai compat path', 'https://generativelanguage.googleapis.com/v1beta/openai', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'],
    ['gemini path with trailing slash', 'https://generativelanguage.googleapis.com/v1beta/openai/', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'],
  ])('builds the right chat-completions URL for %s', (_name, baseUrl, expected) => {
    const spec = customPlugin.buildRequest([userMsg], { enabled: true, baseUrl }, baseParams);
    expect(spec.url).toBe(expected);
  });

  it('omits Authorization when apiKey is missing (LocalAI / unsecured endpoint)', () => {
    const config: ProviderConfig = {
      enabled: true,
      baseUrl: 'http://localhost:8080',
    };

    const spec = customPlugin.buildRequest([userMsg], config, baseParams);

    expect(spec.headers.Authorization).toBeUndefined();
    expect(spec.headers['Content-Type']).toBe('application/json');
  });

  it('omits Authorization when apiKey is an empty string', () => {
    const config: ProviderConfig = {
      enabled: true,
      baseUrl: 'http://localhost:8080',
      apiKey: '',
    };

    const spec = customPlugin.buildRequest([userMsg], config, baseParams);

    expect(spec.headers.Authorization).toBeUndefined();
  });

  // Anthropic's API gates browser-context calls behind this header to surface the
  // API-key-exposure risk. Tauri's webview is browser-like to their server, so we
  // mirror what the native anthropicPlugin already sends. Harmless for other providers.
  it('always sends anthropic-dangerous-direct-browser-access: true so Custom can target Anthropic', () => {
    const spec = customPlugin.buildRequest([userMsg], {
      enabled: true,
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-ant-test',
    }, baseParams);

    expect(spec.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  });
});

// ─── Helpers (tool-calling tests) ─────────────────────────────────────────────

function readerFromChunks(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return stream.getReader();
}

// ─── customPlugin tool calling ────────────────────────────────────────────────

describe('customPlugin tool calling', () => {
  const toolMessages: LoopMessage[] = [{ role: 'user', content: 'use the calc' }];
  const toolParams: ChatParams = { modelId: 'local-model', temperature: 0.5, maxTokens: 1024 };
  const fakeTools = [
    {
      id: 'calc',
      name: 'calc',
      description: 'A calculator',
      parameters: { type: 'object', properties: { x: { type: 'number' } } } as Record<string, unknown>,
    },
  ];

  it('custom_buildToolRequest_uses_normalized_baseUrl_for_chat_completions', () => {
    const config: ProviderConfig = {
      enabled: true,
      baseUrl: 'https://my-llm.example.com',
      apiKey: 'k',
    };

    const spec = customPlugin.buildToolRequest(toolMessages, config, toolParams, fakeTools);

    // normalizeOpenAIBase appends /v1 to a bare host, so the final URL should be
    // https://my-llm.example.com/v1/chat/completions
    expect(spec.url).toBe('https://my-llm.example.com/v1/chat/completions');
  });

  it('custom_buildToolRequest_omits_authorization_when_no_apiKey', () => {
    const config: ProviderConfig = {
      enabled: true,
      baseUrl: 'https://my-llm.example.com',
      apiKey: '',
    };

    const spec = customPlugin.buildToolRequest(toolMessages, config, toolParams, fakeTools);

    // Empty apiKey must not produce an Authorization header (matches buildRequest behavior)
    expect(spec.headers.Authorization).toBeUndefined();
  });

  it('custom_parseToolStream_yields_tool_use_event', async () => {
    // OpenAI-format SSE stream — proves delegation to parseOpenAIToolStream is wired.
    const chunks = [
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"calc","arguments":"{\\"x\\":"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const reader = readerFromChunks(chunks);
    const events: unknown[] = [];
    for await (const event of customPlugin.parseToolStream(reader)) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: 'tool_use', id: 'call_1', name: 'calc', input: { x: 1 } });
    expect(events[events.length - 1]).toEqual({ type: 'message_stop' });
  });
});

describe('customPlugin.getModels', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends Authorization: Bearer <key> when apiKey is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'm-1' }] }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const models = await customPlugin.getModels({
      enabled: true,
      baseUrl: 'https://my-llm.example/api',
      apiKey: 'sk-secret',
    });

    expect(models).toEqual([{ id: 'm-1', label: 'm-1' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://my-llm.example/api/v1/models');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-secret');
  });

  it('does not double-prefix /v1 when the base URL already ends with /v1', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await customPlugin.getModels({
      enabled: true,
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-or-test',
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/models');
  });

  it('omits Authorization header when apiKey is blank', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await customPlugin.getModels({
      enabled: true,
      baseUrl: 'http://localhost:8080',
    });

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
