import { describe, it, expect } from 'vitest';
import { openAIToolsMessages, buildOpenAIToolsBody, parseOpenAIToolStream } from './openaiCompat';
import type { LoopMessage, ChatParams } from '../IProviderPlugin';

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
  for await (const event of parseOpenAIToolStream(reader)) {
    events.push(event);
  }
  return events;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const fakeParams: ChatParams = { modelId: 'gpt-4o', temperature: 0.5, maxTokens: 1024 };

// ─── openAIToolsMessages ──────────────────────────────────────────────────────

describe('openAIToolsMessages', () => {
  it('openaiCompat_messages_emits_tool_calls_for_assistant_with_toolUse', () => {
    const messages: LoopMessage[] = [
      {
        role: 'assistant',
        content: 'thinking',
        toolUse: [{ id: 'call_1', name: 'calc', input: { x: 1 } }],
      },
    ];

    const result = openAIToolsMessages(messages);

    expect(result).toContainEqual({
      role: 'assistant',
      content: 'thinking',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'calc',
            arguments: '{"x":1}',
          },
        },
      ],
    });
  });

  it('openaiCompat_messages_emits_object_arguments_when_stringify_disabled', () => {
    // Ollama's native /api/chat wants `arguments` as an object, not a JSON
    // string; passing a string 400s and breaks the multi-turn tool loop.
    const messages: LoopMessage[] = [
      {
        role: 'assistant',
        content: 'thinking',
        toolUse: [{ id: 'call_1', name: 'calc', input: { x: 1 } }],
      },
    ];

    const result = openAIToolsMessages(messages, { stringifyToolArgs: false });

    expect(result).toContainEqual({
      role: 'assistant',
      content: 'thinking',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'calc',
            arguments: { x: 1 },
          },
        },
      ],
    });
  });

  it('openaiCompat_object_arguments_fall_back_to_empty_object_for_nullish_input', () => {
    const messages: LoopMessage[] = [
      {
        role: 'assistant',
        content: '',
        // A no-argument tool call whose input never got populated.
        toolUse: [{ id: 'call_1', name: 'clipboard-read', input: undefined as never }],
      },
    ];

    const result = openAIToolsMessages(messages, { stringifyToolArgs: false }) as Array<{
      tool_calls?: Array<{ function: { arguments: unknown } }>;
    }>;

    expect(result[0].tool_calls?.[0].function.arguments).toEqual({});
  });

  it('openaiCompat_messages_emits_tool_role_with_tool_call_id', () => {
    const messages: LoopMessage[] = [{ role: 'tool', content: '42', toolUseId: 'call_1' }];

    const result = openAIToolsMessages(messages);

    expect(result).toEqual([{ role: 'tool', tool_call_id: 'call_1', content: '42' }]);
  });

  it('openaiCompat_messages_encodes_fqid_in_historical_tool_calls', () => {
    // agentLoop.ts stores the resolved FQID (e.g. "builtin:calculator") as
    // `toolUse[].name`, not the wire-safe id. On turn 2+ of a tool
    // conversation, that FQID gets replayed as history — it must be
    // re-encoded so it matches the wire-safe name declared in `tools`,
    // otherwise OpenAI-compatible providers reject the invalid characters.
    const messages: LoopMessage[] = [
      {
        role: 'assistant',
        content: 'thinking',
        toolUse: [{ id: 'call_1', name: 'builtin:calculator', input: { x: 1 } }],
      },
    ];

    const result = openAIToolsMessages(messages);

    expect(result).toContainEqual({
      role: 'assistant',
      content: 'thinking',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'builtin__calculator',
            arguments: JSON.stringify({ x: 1 }),
          },
        },
      ],
    });
  });
});

// ─── buildOpenAIToolsBody ─────────────────────────────────────────────────────

describe('buildOpenAIToolsBody', () => {
  it('openaiCompat_buildToolsBody_includes_tools_array_in_openai_function_format', () => {
    const messages: LoopMessage[] = [{ role: 'user', content: 'use the calc' }];
    const tools = [
      {
        id: 'calc',
        name: 'calc',
        description: 'A calc',
        parameters: {
          type: 'object',
          properties: { x: { type: 'number' } },
          required: ['x'],
        } as Record<string, unknown>,
      },
    ];

    const body = buildOpenAIToolsBody(messages, fakeParams, tools) as Record<string, unknown>;

    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'calc',
          description: 'A calc',
          parameters: {
            type: 'object',
            properties: { x: { type: 'number' } },
            required: ['x'],
          },
        },
      },
    ]);
    expect(body.stream).toBe(true);
    expect(body.model).toBe(fakeParams.modelId);
  });

  it('openaiCompat_buildToolsBody_uses_wire_safe_id_not_display_name', () => {
    // Built-in tools have human-readable display names with spaces (e.g.
    // "Search Launcher Index"). OpenAI's function name validation rejects
    // spaces, and the wire-safe `id` is also what `wireToFqid` in
    // agentLoop.ts uses to resolve tool_calls back to the original tool.
    const messages: LoopMessage[] = [{ role: 'user', content: 'search for files' }];
    const tools = [
      {
        id: 'builtin__search-launcher-index',
        name: 'Search Launcher Index',
        description: 'Searches the launcher index',
        parameters: { type: 'object', properties: {} } as Record<string, unknown>,
      },
    ];

    const body = buildOpenAIToolsBody(messages, fakeParams, tools) as Record<string, unknown>;
    const toolsArray = body.tools as Array<{ function: { name: string } }>;

    expect(toolsArray[0].function.name).toBe('builtin__search-launcher-index');
  });
});

// ─── parseOpenAIToolStream ────────────────────────────────────────────────────

describe('parseOpenAIToolStream', () => {
  it('openaiCompat_parseToolStream_yields_text_from_delta_content', async () => {
    const chunks = [
      'data: {"choices":[{"index":0,"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":" world"}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const reader = readerFromChunks(chunks);
    const events = await collectToolStreamEvents(reader);

    expect(events).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'message_stop' },
    ]);
  });

  it('openaiCompat_parseToolStream_accumulates_function_arguments_across_deltas', async () => {
    const chunks = [
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"calc","arguments":"{\\"x\\":"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const reader = readerFromChunks(chunks);
    const events = await collectToolStreamEvents(reader);

    expect(events).toContainEqual({
      type: 'tool_use',
      id: 'call_1',
      name: 'calc',
      input: { x: 1 },
    });
    expect(events[events.length - 1]).toEqual({ type: 'message_stop' });
    expect(events.filter((e) => e.type === 'text')).toHaveLength(0);
  });
});
