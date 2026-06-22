import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { ollamaPlugin } from './ollama';
import type { LoopMessage, ChatParams, ProviderConfig } from '../IProviderPlugin';

// getModels must go through the Tauri HTTP plugin (Rust/reqwest), NOT the WebView's
// global fetch. The WebView path carries an Origin header (`http://tauri.localhost`
// on Windows) that Ollama's CORS allowlist rejects, so "Test & Fetch Models" silently
// fails on Windows while macOS (`tauri://localhost`) passes. Routing through Rust has
// no Origin and no CORS, so it works on every OS — matching how the chat engine already
// fetches (see aiEngine.ts).
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));

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

const fakeConfig: ProviderConfig = { enabled: true, baseUrl: 'http://localhost:11434', apiKey: '' };
const fakeParams: ChatParams = { modelId: 'llama3', temperature: 0.5, maxTokens: 1024 };
const fakeMessages: LoopMessage[] = [{ role: 'user', content: 'hello' }];
const fakeTools = [
  {
    id: 'calc',
    name: 'calc',
    description: 'A calculator',
    parameters: { type: 'object', properties: { x: { type: 'number' } } } as Record<string, unknown>,
  },
];

// ─── getModels transport ──────────────────────────────────────────────────────

describe('ollamaPlugin.getModels transport', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.clearAllMocks();
  });

  it('ollama_getModels_routes_through_tauri_http_plugin_not_webview_fetch', async () => {
    // WebView fetch is sabotaged so any reliance on it produces the WRONG result.
    const webViewFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    globalThis.fetch = webViewFetch as unknown as typeof fetch;

    vi.mocked(tauriFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: 'llama3.1:latest' }] }),
    } as unknown as Response);

    const models = await ollamaPlugin.getModels({ enabled: true, baseUrl: 'http://localhost:11434' });

    expect(tauriFetch).toHaveBeenCalledTimes(1);
    expect(tauriFetch).toHaveBeenCalledWith('http://localhost:11434/api/tags');
    expect(webViewFetch).not.toHaveBeenCalled();
    expect(models).toEqual([{ id: 'llama3.1:latest', label: 'llama3.1:latest' }]);
  });
});

// ─── buildToolRequest ─────────────────────────────────────────────────────────

describe('ollamaPlugin.buildToolRequest', () => {
  it('ollama_buildToolRequest_uses_api_chat_path_no_v1', () => {
    const spec = ollamaPlugin.buildToolRequest(fakeMessages, fakeConfig, fakeParams, fakeTools);

    // Ollama uses /api/chat, NOT /v1/chat/completions
    expect(spec.url).toBe('http://localhost:11434/api/chat');
  });

  it('ollama_buildToolRequest_no_authorization_header', () => {
    const spec = ollamaPlugin.buildToolRequest(fakeMessages, fakeConfig, fakeParams, fakeTools);

    // Ollama runs locally without auth — no Authorization header expected
    expect(spec.headers.Authorization).toBeUndefined();
  });
});

// ─── parseToolStream ──────────────────────────────────────────────────────────

describe('ollamaPlugin.parseToolStream', () => {
  it('ollama_parseToolStream_yields_text_from_message_content', async () => {
    // Ollama NDJSON streaming format (NOT SSE, NOT [DONE] sentinel)
    const chunks = [
      '{"message":{"role":"assistant","content":"Hello"},"done":false}\n',
      '{"message":{"role":"assistant","content":" world"},"done":false}\n',
      '{"message":{"role":"assistant","content":""},"done":true}\n',
    ];

    const reader = readerFromChunks(chunks);
    const events: unknown[] = [];
    for await (const event of ollamaPlugin.parseToolStream(reader)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'message_stop' },
    ]);
  });

  it('ollama_parseToolStream_yields_tool_use_from_message_tool_calls_with_synthesized_id', async () => {
    // Ollama emits tool_calls with function.arguments as a JSON object (not a string).
    // Because Ollama provides no tool-call id, the parser must synthesize one
    // deterministically. Expected pattern: 'ollama-<n>' where n starts at 1 per stream.
    const chunks = [
      '{"message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"calc","arguments":{"x":1}}}]},"done":false}\n',
      '{"message":{"role":"assistant","content":""},"done":true}\n',
    ];

    const reader = readerFromChunks(chunks);
    const events: unknown[] = [];
    for await (const event of ollamaPlugin.parseToolStream(reader)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'tool_use', id: 'ollama-1', name: 'calc', input: { x: 1 } },
      { type: 'message_stop' },
    ]);
  });
});
