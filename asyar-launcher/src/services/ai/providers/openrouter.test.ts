import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { openrouterPlugin } from './openrouter';
import type { LoopMessage, ChatParams, ProviderConfig } from '../IProviderPlugin';

// getModels must route through the Tauri HTTP plugin (Rust/reqwest), not the WebView's
// global fetch — the WebView path is CORS-bound and fails on Windows (origin
// `http://tauri.localhost`). Routing through Rust has no Origin/CORS, like the chat engine.
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));

describe('openrouterPlugin.getModels transport', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.clearAllMocks();
  });

  it('openrouter_getModels_routes_through_tauri_http_plugin_not_webview_fetch', async () => {
    const webViewFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    globalThis.fetch = webViewFetch as unknown as typeof fetch;

    vi.mocked(tauriFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'openai/gpt-4o', name: 'GPT-4o' }] }),
    } as unknown as Response);

    const models = await openrouterPlugin.getModels({ enabled: true, apiKey: 'or-key' });

    expect(tauriFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(tauriFetch).mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/models');
    expect(webViewFetch).not.toHaveBeenCalled();
    expect(models).toEqual([{ id: 'openai/gpt-4o', label: 'GPT-4o', reasoningEfforts: [] }]);
  });

  it('reads model-specific reasoning levels from OpenRouter metadata', async () => {
    vi.mocked(tauriFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'openai/gpt-reasoning',
            reasoning: { supported_efforts: ['high', 'medium', 'low', 'future-value'] },
          },
        ],
      }),
    } as unknown as Response);

    const models = await openrouterPlugin.getModels({ enabled: true, apiKey: 'or-key' });

    expect(models[0].reasoningEfforts).toEqual(['low', 'medium', 'high']);
  });

  it('treats null supported efforts as all gateway effort values', async () => {
    vi.mocked(tauriFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'gateway-reasoning-model', reasoning: { supported_efforts: null } }],
      }),
    } as unknown as Response);

    const models = await openrouterPlugin.getModels({ enabled: true, apiKey: 'or-key' });

    expect(models[0].reasoningEfforts).toEqual([
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
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

const fakeConfig: ProviderConfig = { enabled: true, apiKey: 'or-test' };
const fakeParams: ChatParams = { modelId: 'openai/gpt-4o', temperature: 0.5, maxTokens: 1024 };
const fakeMessages: LoopMessage[] = [{ role: 'user', content: 'hello' }];
const fakeTools = [
  {
    id: 'calc',
    name: 'calc',
    description: 'A calculator',
    parameters: { type: 'object', properties: { x: { type: 'number' } } } as Record<
      string,
      unknown
    >,
  },
];

// ─── buildToolRequest ─────────────────────────────────────────────────────────

describe('openrouterPlugin.buildToolRequest', () => {
  it('maps configured effort to OpenRouter reasoning for plain and tool requests', () => {
    const config: ProviderConfig = { ...fakeConfig, reasoningEffort: 'medium' };
    const plain = openrouterPlugin.buildRequest(
      [{ id: 'm1', role: 'user', content: 'Hello', timestamp: 0 }],
      config,
      fakeParams,
    );
    const tool = openrouterPlugin.buildToolRequest(fakeMessages, config, fakeParams, fakeTools);

    expect(plain.body).toMatchObject({ reasoning: { effort: 'medium' } });
    expect(tool.body).toMatchObject({ reasoning: { effort: 'medium' } });
  });

  it('openrouter_buildToolRequest_targets_openrouter_v1_chat_completions', () => {
    const spec = openrouterPlugin.buildToolRequest(fakeMessages, fakeConfig, fakeParams, fakeTools);

    expect(spec.url).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('openrouter_buildToolRequest_attaches_bearer_referer_and_title_headers', () => {
    const spec = openrouterPlugin.buildToolRequest(fakeMessages, fakeConfig, fakeParams, fakeTools);

    expect(spec.headers.Authorization).toBe('Bearer or-test');
    expect(spec.headers['HTTP-Referer']).toBe('https://asyar.app');
    expect(spec.headers['X-Title']).toBe('Asyar');
  });

  it('replays reasoning details on the assistant tool-call message', () => {
    const reasoningDetails = [
      {
        type: 'reasoning.encrypted',
        data: 'opaque',
        id: 'reasoning-1',
        format: 'anthropic-claude-v1',
        index: 0,
      },
    ];
    const messages: LoopMessage[] = [
      { role: 'user', content: 'Calculate it' },
      {
        role: 'assistant',
        content: '',
        toolUse: [{ id: 'call_1', name: 'calc', input: { x: 1 } }],
        providerContext: reasoningDetails,
      },
      { role: 'tool', toolUseId: 'call_1', content: '2' },
    ];

    const spec = openrouterPlugin.buildToolRequest(messages, fakeConfig, fakeParams, fakeTools);
    const body = spec.body as { messages: Array<Record<string, unknown>> };

    expect(body.messages[1].reasoning_details).toEqual(reasoningDetails);
  });
});

// ─── parseToolStream ──────────────────────────────────────────────────────────

describe('openrouterPlugin.parseToolStream', () => {
  it('openrouter_parseToolStream_yields_tool_use_event', async () => {
    // OpenAI-format SSE stream with a tool call split across two delta chunks,
    // matching the fixture used in _openaiCompat.test.ts.
    const chunks = [
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"calc","arguments":"{\\"x\\":"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const reader = readerFromChunks(chunks);
    const events: unknown[] = [];
    for await (const event of openrouterPlugin.parseToolStream(reader)) {
      events.push(event);
    }

    expect(events).toContainEqual({
      type: 'tool_use',
      id: 'call_1',
      name: 'calc',
      input: { x: 1 },
    });
    expect(events[events.length - 1]).toEqual({ type: 'message_stop' });
  });

  it('preserves streamed reasoning details in their original order', async () => {
    const first = {
      type: 'reasoning.summary',
      summary: 'Checking the inputs',
      id: 'reasoning-1',
      format: 'anthropic-claude-v1',
      index: 0,
    };
    const second = {
      type: 'reasoning.encrypted',
      data: 'opaque',
      id: 'reasoning-2',
      format: 'anthropic-claude-v1',
      index: 1,
    };
    const reader = readerFromChunks([
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_details: [first] } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_details: [second] } }] })}\n\n`,
      'data: [DONE]\n\n',
    ]);

    const events = [];
    for await (const event of openrouterPlugin.parseToolStream(reader)) events.push(event);

    expect(events).toEqual([
      { type: 'provider_context', item: first },
      { type: 'provider_context', item: second },
      { type: 'message_stop' },
    ]);
  });
});
