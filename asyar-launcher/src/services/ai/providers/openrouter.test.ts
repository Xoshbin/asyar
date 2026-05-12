import { describe, it, expect } from 'vitest';
import { openrouterPlugin } from './openrouter';
import type { LoopMessage, ChatParams, ProviderConfig } from '../IProviderPlugin';

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
    parameters: { type: 'object', properties: { x: { type: 'number' } } } as Record<string, unknown>,
  },
];

// ─── buildToolRequest ─────────────────────────────────────────────────────────

describe('openrouterPlugin.buildToolRequest', () => {
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

    expect(events).toContainEqual({ type: 'tool_use', id: 'call_1', name: 'calc', input: { x: 1 } });
    expect(events[events.length - 1]).toEqual({ type: 'message_stop' });
  });
});
