import { describe, expect, it } from 'vitest';
import type { ChatParams, LoopMessage, ProviderConfig } from '../IProviderPlugin';
import {
  buildOpenAIResponsesToolBody,
  parseOpenAIResponsesStream,
  parseOpenAIResponsesToolStream,
  usesOpenAIResponses,
} from './openaiResponses';

function readerFromChunks(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }).getReader();
}

const config: ProviderConfig = {
  enabled: true,
  hostedWebSearch: true,
  reasoningEffort: 'low',
};

const params: ChatParams = {
  modelId: 'gpt-test',
  temperature: 0.5,
  maxTokens: 1024,
};

describe('usesOpenAIResponses', () => {
  it('preserves Chat Completions when the setting is missing', () => {
    expect(usesOpenAIResponses()).toBe(false);
    expect(usesOpenAIResponses({ enabled: true })).toBe(false);
  });

  it('uses Responses only when explicitly configured', () => {
    expect(usesOpenAIResponses({ enabled: true, openAIApiMode: 'responses' })).toBe(true);
  });
});

describe('buildOpenAIResponsesToolBody', () => {
  it('maps conversation messages, function calls, results and hosted search to Responses items', () => {
    const messages: LoopMessage[] = [
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Calculate it.' },
      {
        role: 'assistant',
        content: '',
        toolUse: [{ id: 'call_1', name: 'builtin:calc', input: { x: 1 } }],
        providerContext: [{ type: 'reasoning', encrypted_content: 'encrypted-reasoning' }],
      },
      { role: 'tool', toolUseId: 'call_1', content: '2' },
    ];

    const body = buildOpenAIResponsesToolBody(messages, config, params, [
      {
        id: 'builtin__calc',
        name: 'Calculator',
        description: 'Calculate a value',
        parameters: { type: 'object', properties: { x: { type: 'number' } } },
      },
    ]);

    expect(body).toMatchObject({
      model: 'gpt-test',
      stream: true,
      store: false,
      max_output_tokens: 1024,
      reasoning: { effort: 'low' },
      input: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Calculate it.' },
        { type: 'reasoning', encrypted_content: 'encrypted-reasoning' },
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'builtin__calc',
          arguments: '{"x":1}',
        },
        { type: 'function_call_output', call_id: 'call_1', output: '2' },
      ],
      tools: [
        { type: 'function', name: 'builtin__calc', strict: false },
        { type: 'web_search', search_context_size: 'medium' },
      ],
      include: ['reasoning.encrypted_content', 'web_search_call.action.sources'],
    });
  });

  it('leaves reasoning to the model when no effort is configured', () => {
    const body = buildOpenAIResponsesToolBody(
      [{ role: 'user', content: 'Hello' }],
      { enabled: true },
      params,
      [],
    );

    expect(body).not.toHaveProperty('reasoning');
  });
});

describe('Responses SSE parsing', () => {
  it('streams search activity separately from output text', async () => {
    const reader = readerFromChunks([
      'event: response.web_search_call.in_progress\ndata: {"type":"response.web_search_call.in_progress"}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hel',
      'lo"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed"}\n\n',
    ]);

    const events = [];
    for await (const event of parseOpenAIResponsesStream(reader)) events.push(event);
    expect(events).toEqual([{ type: 'status', status: 'searching' }, 'Hello']);
  });

  it('normalizes completed Responses function calls for the agent loop', async () => {
    const reader = readerFromChunks([
      'data: {"type":"response.web_search_call.searching"}\n\n',
      'data: {"type":"response.output_text.delta","delta":"Checking "}\n\n',
      'data: {"type":"response.output_item.done","item":{"type":"reasoning","encrypted_content":"opaque"}}\n\n',
      'data: {"type":"response.output_item.done","item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"calc","arguments":"{\\"x\\":1}"}}\n\n',
      'data: {"type":"response.completed"}\n\n',
    ]);

    const events = [];
    for await (const event of parseOpenAIResponsesToolStream(reader)) events.push(event);

    expect(events).toEqual([
      { type: 'status', status: 'searching' },
      { type: 'text', text: 'Checking ' },
      {
        type: 'provider_context',
        item: { type: 'reasoning', encrypted_content: 'opaque' },
      },
      { type: 'tool_use', id: 'call_1', name: 'calc', input: { x: 1 } },
      { type: 'message_stop' },
    ]);
  });

  it('surfaces a failed Responses event as an exception', async () => {
    const reader = readerFromChunks([
      'data: {"type":"response.failed","response":{"error":{"message":"bad request"}}}\n\n',
    ]);

    await expect(async () => {
      for await (const _event of parseOpenAIResponsesStream(reader)) {
        // exhaust the generator
      }
    }).rejects.toThrow('bad request');
  });
});
