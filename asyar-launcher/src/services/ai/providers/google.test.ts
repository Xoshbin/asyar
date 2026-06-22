import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { googlePlugin } from './google';
import type { LoopMessage, ChatParams, ProviderConfig } from '../IProviderPlugin';

// getModels must route through the Tauri HTTP plugin (Rust/reqwest), not the WebView's
// global fetch — the WebView path is CORS-bound and fails on Windows (origin
// `http://tauri.localhost`). Routing through Rust has no Origin/CORS, like the chat engine.
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));

describe('googlePlugin.getModels transport', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.clearAllMocks();
  });

  it('google_getModels_routes_through_tauri_http_plugin_not_webview_fetch', async () => {
    const webViewFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    globalThis.fetch = webViewFetch as unknown as typeof fetch;

    vi.mocked(tauriFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: 'models/gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', supportedGenerationMethods: ['generateContent'] }],
      }),
    } as unknown as Response);

    const models = await googlePlugin.getModels({ enabled: true, apiKey: 'g-key' });

    expect(tauriFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(tauriFetch).mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/models');
    expect(webViewFetch).not.toHaveBeenCalled();
    expect(models).toEqual([{ id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' }]);
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

const fakeConfig: ProviderConfig = { enabled: true, apiKey: 'test-api-key' };
const fakeParams: ChatParams = { modelId: 'gemini-2.0-flash', temperature: 0.7, maxTokens: 4096 };

// ─── buildToolRequest ─────────────────────────────────────────────────────────

describe('googlePlugin.buildToolRequest', () => {
  it('google_buildToolRequest_hoists_system_to_systemInstruction', () => {
    const messages: LoopMessage[] = [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Hello' },
    ];

    const spec = googlePlugin.buildToolRequest(messages, fakeConfig, fakeParams, []);
    const body = spec.body as Record<string, unknown>;
    const systemInstruction = body.systemInstruction as Record<string, unknown>;
    const parts = systemInstruction.parts as Array<Record<string, unknown>>;

    // System message hoisted to systemInstruction
    expect(parts[0].text).toBe('You are helpful');

    // System message NOT present in contents[]
    const contents = body.contents as Array<Record<string, unknown>>;
    expect(contents.every((c) => c.role !== 'system')).toBe(true);
    // Only the user message should be in contents
    expect(contents).toHaveLength(1);
  });

  it('google_buildToolRequest_maps_assistant_to_model_role', () => {
    const messages: LoopMessage[] = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'hello' },
    ];

    const spec = googlePlugin.buildToolRequest(messages, fakeConfig, fakeParams, []);
    const body = spec.body as Record<string, unknown>;
    const contents = body.contents as Array<Record<string, unknown>>;

    expect(contents[1].role).toBe('model');
    expect(contents[1].parts).toEqual([{ text: 'hello' }]);
  });

  it('google_buildToolRequest_emits_functionCall_with_id_for_assistant_toolUse', () => {
    const messages: LoopMessage[] = [
      {
        role: 'assistant',
        content: 'thinking',
        toolUse: [{ id: 'tu1', name: 'calc', input: { x: 1 } }],
      },
    ];

    const spec = googlePlugin.buildToolRequest(messages, fakeConfig, fakeParams, []);
    const body = spec.body as Record<string, unknown>;
    const contents = body.contents as Array<Record<string, unknown>>;

    expect(contents).toHaveLength(1);
    const parts = contents[0].parts as Array<Record<string, unknown>>;

    // Must include a text part for the content
    expect(parts).toContainEqual({ text: 'thinking' });
    // Must include a functionCall part with id preserved
    expect(parts).toContainEqual({
      functionCall: { id: 'tu1', name: 'calc', args: { x: 1 } },
    });
  });

  it('google_buildToolRequest_emits_functionResponse_with_id_and_name_for_tool_role', () => {
    const messages: LoopMessage[] = [
      { role: 'user', content: 'use the calc' },
      {
        role: 'assistant',
        content: '',
        toolUse: [{ id: 'tu1', name: 'calc', input: { x: 1 } }],
      },
      { role: 'tool', content: '42', toolUseId: 'tu1' },
    ];

    const spec = googlePlugin.buildToolRequest(messages, fakeConfig, fakeParams, []);
    const body = spec.body as Record<string, unknown>;
    const contents = body.contents as Array<Record<string, unknown>>;

    // Tool message becomes a user-role envelope with a functionResponse part
    const toolTurn = contents[2];
    expect(toolTurn.role).toBe('user');
    const parts = toolTurn.parts as Array<Record<string, unknown>>;
    expect(parts).toEqual([
      {
        functionResponse: {
          id: 'tu1',
          name: 'calc',
          response: { output: 42 },
        },
      },
    ]);
  });

  it('google_buildToolRequest_includes_functionDeclarations_per_tool', () => {
    const messages: LoopMessage[] = [{ role: 'user', content: 'use the calc' }];
    const tools = [
      {
        id: 'calc',
        name: 'calc',
        description: 'A calc',
        parameters: {
          type: 'object',
          properties: { x: { type: 'number' } },
        } as Record<string, unknown>,
      },
    ];

    const spec = googlePlugin.buildToolRequest(messages, fakeConfig, fakeParams, tools);
    const body = spec.body as Record<string, unknown>;

    expect(body.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: 'calc',
            description: 'A calc',
            parameters: { type: 'object', properties: { x: { type: 'number' } } },
          },
        ],
      },
    ]);
  });
});

// ─── parseToolStream ──────────────────────────────────────────────────────────

describe('googlePlugin.parseToolStream', () => {
  it('google_parseToolStream_yields_text_from_parts_text', async () => {
    const chunks = [
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]},"index":0,"finishReason":null}]}\n\n',
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":" world"}]},"index":0,"finishReason":"STOP"}]}\n\n',
    ];

    const reader = readerFromChunks(chunks);
    const events: unknown[] = [];
    for await (const event of googlePlugin.parseToolStream(reader)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'message_stop' },
    ]);
  });

  it('google_parseToolStream_yields_tool_use_with_id_from_functionCall_when_present', async () => {
    const chunks = [
      'data: {"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"id":"fc_abc","name":"calc","args":{"x":1}}}]},"index":0,"finishReason":"STOP"}]}\n\n',
    ];

    const reader = readerFromChunks(chunks);
    const events: unknown[] = [];
    for await (const event of googlePlugin.parseToolStream(reader)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'tool_use', id: 'fc_abc', name: 'calc', input: { x: 1 } },
      { type: 'message_stop' },
    ]);
  });

  it('google_parseToolStream_synthesizes_id_when_functionCall_id_absent', async () => {
    const chunks = [
      'data: {"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"calc","args":{"x":1}}}]},"index":0,"finishReason":"STOP"}]}\n\n',
    ];

    const reader = readerFromChunks(chunks);
    const events: unknown[] = [];
    for await (const event of googlePlugin.parseToolStream(reader)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'tool_use', id: 'gemini-1', name: 'calc', input: { x: 1 } },
      { type: 'message_stop' },
    ]);
  });
});
