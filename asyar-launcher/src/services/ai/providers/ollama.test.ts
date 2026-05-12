import { describe, it, expect } from 'vitest';
import { ollamaPlugin } from './ollama';
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
