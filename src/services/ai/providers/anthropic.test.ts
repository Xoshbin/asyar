import { describe, it, expect } from 'vitest';
import { anthropicPlugin } from './anthropic';
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

async function collectToolStreamEvents(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const events = [];
  for await (const event of anthropicPlugin.parseToolStream(reader)) {
    events.push(event);
  }
  return events;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const fakeConfig: ProviderConfig = { enabled: true, apiKey: 'sk-test-key' };
const fakeParams: ChatParams = { modelId: 'claude-3-haiku', temperature: 0.5, maxTokens: 1024 };

// ─── buildToolRequest ─────────────────────────────────────────────────────────

describe('anthropicPlugin.buildToolRequest', () => {
  it('anthropic_buildToolRequest_emits_tool_use_blocks_for_assistant_with_toolUse', () => {
    const messages: LoopMessage[] = [
      {
        role: 'assistant',
        content: 'thinking...',
        toolUse: [{ id: 'tu1', name: 'calc', input: { x: 1 } }],
      },
    ];

    const spec = anthropicPlugin.buildToolRequest(messages, fakeConfig, fakeParams, []);
    const body = spec.body as Record<string, unknown>;
    const msgs = body.messages as Array<Record<string, unknown>>;

    expect(msgs).toHaveLength(1);
    const assistantMsg = msgs[0];
    expect(assistantMsg.role).toBe('assistant');

    const content = assistantMsg.content as Array<Record<string, unknown>>;
    expect(content).toContainEqual({ type: 'text', text: 'thinking...' });
    expect(content).toContainEqual({ type: 'tool_use', id: 'tu1', name: 'calc', input: { x: 1 } });
  });

  it('anthropic_buildToolRequest_emits_tool_result_block_for_tool_role', () => {
    const messages: LoopMessage[] = [
      { role: 'tool', content: '42', toolUseId: 'tu1' },
    ];

    const spec = anthropicPlugin.buildToolRequest(messages, fakeConfig, fakeParams, []);
    const body = spec.body as Record<string, unknown>;
    const msgs = body.messages as Array<Record<string, unknown>>;

    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu1', content: '42' }],
    });
  });

  it('anthropic_buildToolRequest_hoists_system_to_top_level_field', () => {
    const messages: LoopMessage[] = [
      { role: 'system', content: 'You are a test assistant.' },
      { role: 'user', content: 'Hello' },
    ];

    const spec = anthropicPlugin.buildToolRequest(messages, fakeConfig, fakeParams, []);
    const body = spec.body as Record<string, unknown>;
    const msgs = body.messages as Array<Record<string, unknown>>;

    // System hoisted to top-level body.system
    expect(body.system).toBe('You are a test assistant.');
    // System message NOT in body.messages
    expect(msgs.every((m) => m.role !== 'system')).toBe(true);
    // Only the user message remains
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ role: 'user', content: 'Hello' });
  });

  it('anthropic_buildToolRequest_attaches_tools_with_input_schema', () => {
    const messages: LoopMessage[] = [{ role: 'user', content: 'use the calc' }];
    const tools = [
      {
        id: 'calc',
        name: 'calc',
        description: 'A calculator',
        parameters: { type: 'object', properties: { x: { type: 'number' } } } as Record<string, unknown>,
      },
    ];

    const spec = anthropicPlugin.buildToolRequest(messages, fakeConfig, fakeParams, tools);
    const body = spec.body as Record<string, unknown>;

    // Note: anthropic.ts maps t.id (not t.name) to the tool name field
    expect(body.tools).toEqual([
      {
        name: 'calc',
        description: 'A calculator',
        input_schema: { type: 'object', properties: { x: { type: 'number' } } },
      },
    ]);
  });
});

// ─── parseToolStream ──────────────────────────────────────────────────────────

describe('anthropicPlugin.parseToolStream', () => {
  it('anthropic_parseToolStream_yields_text_for_text_delta_events', async () => {
    const chunks = [
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];

    const reader = readerFromChunks(chunks);
    const events = await collectToolStreamEvents(reader);

    expect(events).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'message_stop' },
    ]);
  });

  it('anthropic_parseToolStream_yields_tool_use_with_accumulated_input_json', async () => {
    const chunks = [
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu1","name":"calc"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\\"x\\\":"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"1}"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];

    const reader = readerFromChunks(chunks);
    const events = await collectToolStreamEvents(reader);

    expect(events).toEqual([
      { type: 'tool_use', id: 'tu1', name: 'calc', input: { x: 1 } },
      { type: 'message_stop' },
    ]);
  });
});
