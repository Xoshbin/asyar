import type { LoopMessage, ChatParams, ToolStreamEvent } from '../IProviderPlugin';

export interface OpenAIToolDescriptor {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export function openAIToolsMessages(messages: LoopMessage[]): unknown[] {
  const result: unknown[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      result.push({ role: 'system', content: msg.content });
    } else if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      if (msg.toolUse && msg.toolUse.length > 0) {
        result.push({
          role: 'assistant',
          content: msg.content,
          tool_calls: msg.toolUse.map((tu) => ({
            id: tu.id,
            type: 'function',
            function: {
              name: tu.name,
              arguments: JSON.stringify(tu.input),
            },
          })),
        });
      } else {
        result.push({ role: 'assistant', content: msg.content });
      }
    } else if (msg.role === 'tool') {
      result.push({ role: 'tool', tool_call_id: msg.toolUseId, content: msg.content });
    }
  }
  return result;
}

export function buildOpenAIToolsBody(
  messages: LoopMessage[],
  params: ChatParams,
  tools: OpenAIToolDescriptor[],
): unknown {
  const body: Record<string, unknown> = {
    model: params.modelId,
    stream: true,
    messages: openAIToolsMessages(messages),
    tools: tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    })),
  };
  if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;
  if (params.temperature !== undefined) body.temperature = params.temperature;
  return body;
}

// OpenAI splits tool-call arguments across multiple delta chunks keyed by index.
// We accumulate per-index until finish_reason:'tool_calls' signals completion.
export async function* parseOpenAIToolStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<ToolStreamEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  const toolAccumulator = new Map<number, { id: string; name: string; argumentsJson: string }>();

  function* flushTools(): Generator<ToolStreamEvent> {
    for (const [, entry] of toolAccumulator) {
      let input: unknown = {};
      try {
        input = JSON.parse(entry.argumentsJson || '{}');
      } catch { /* use empty object on parse failure */ }
      yield { type: 'tool_use', id: entry.id, name: entry.name, input };
    }
    toolAccumulator.clear();
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6).trim();

      if (data === '[DONE]') {
        yield* flushTools();
        yield { type: 'message_stop' };
        return;
      }

      try {
        const json = JSON.parse(data) as {
          choices?: Array<{
            index?: number;
            delta?: {
              content?: string;
              tool_calls?: Array<{
                index: number;
                id?: string;
                type?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
            finish_reason?: string | null;
          }>;
        };

        const choice = json.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta;

        if (delta?.content != null && typeof delta.content === 'string') {
          yield { type: 'text', text: delta.content };
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolAccumulator.has(idx)) {
              toolAccumulator.set(idx, { id: '', name: '', argumentsJson: '' });
            }
            const entry = toolAccumulator.get(idx)!;
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name = tc.function.name;
            if (tc.function?.arguments) entry.argumentsJson += tc.function.arguments;
          }
        }

        if (choice.finish_reason === 'tool_calls') {
          yield* flushTools();
        }
      } catch { /* skip malformed SSE lines */ }
    }
  }

  yield* flushTools();
  yield { type: 'message_stop' };
}
