import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { openaiPlugin } from './openai';
import type { LoopMessage, ChatParams, ProviderConfig } from '../IProviderPlugin';

// getModels must route through the Tauri HTTP plugin (Rust/reqwest), not the WebView's
// global fetch — the WebView path is CORS-bound and fails on Windows (origin
// `http://tauri.localhost`). Routing through Rust has no Origin/CORS, like the chat engine.
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));

describe('openaiPlugin.getModels transport', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.clearAllMocks();
  });

  it('openai_getModels_routes_through_tauri_http_plugin_not_webview_fetch', async () => {
    const webViewFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    globalThis.fetch = webViewFetch as unknown as typeof fetch;

    vi.mocked(tauriFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-4o' }, { id: 'whisper-1' }] }),
    } as unknown as Response);

    const models = await openaiPlugin.getModels({ enabled: true, apiKey: 'sk-test' });

    expect(tauriFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(tauriFetch).mock.calls[0][0]).toBe('https://api.openai.com/v1/models');
    expect(webViewFetch).not.toHaveBeenCalled();
    expect(models).toEqual([{ id: 'gpt-4o', label: 'gpt-4o' }]);
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const fakeConfig: ProviderConfig = {
  enabled: true,
  apiKey: 'sk-test',
  baseUrl: 'https://api.openai.com',
};

const fakeParams: ChatParams = { modelId: 'gpt-4o', temperature: 0.5, maxTokens: 1024 };

const fakeTools = [
  {
    id: 'calc',
    name: 'calc',
    description: 'A calculator',
    parameters: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] } as Record<string, unknown>,
  },
];

// ─── openaiPlugin.buildToolRequest ───────────────────────────────────────────

describe('openaiPlugin.buildToolRequest', () => {
  it('openai_buildToolRequest_targets_v1_chat_completions_with_baseUrl', () => {
    const messages: LoopMessage[] = [{ role: 'user', content: 'Hello' }];

    const spec = openaiPlugin.buildToolRequest(messages, fakeConfig, fakeParams, fakeTools);

    expect(spec.url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('openai_buildToolRequest_attaches_bearer_authorization_and_json_content_type', () => {
    const messages: LoopMessage[] = [{ role: 'user', content: 'Hello' }];

    const spec = openaiPlugin.buildToolRequest(messages, fakeConfig, fakeParams, fakeTools);

    expect(spec.headers['Authorization']).toBe('Bearer sk-test');
    expect(spec.headers['Content-Type']).toBe('application/json');
  });
});

// ─── openaiPlugin.parseToolStream ────────────────────────────────────────────

describe('openaiPlugin.parseToolStream', () => {
  it('openai_parseToolStream_delegates_through_to_yield_tool_use', async () => {
    const chunks = [
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"calc","arguments":"{\\"x\\":"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const reader = readerFromChunks(chunks);
    const events = [];
    for await (const event of openaiPlugin.parseToolStream(reader)) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: 'tool_use', id: 'call_1', name: 'calc', input: { x: 1 } });
  });
});
