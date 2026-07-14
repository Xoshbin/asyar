import { encodeToolIdForWire } from '../IProviderPlugin';
import type {
  ChatMessage,
  ChatParams,
  ChatStreamEvent,
  LoopMessage,
  ProviderConfig,
  ToolStreamEvent,
} from '../IProviderPlugin';
import type { OpenAIToolDescriptor } from './openaiCompat';

export const HOSTED_WEB_SEARCH_TOOL = {
  type: 'web_search',
  search_context_size: 'medium',
} as const;

type JsonObject = Record<string, unknown>;

export function usesOpenAIResponses(config?: ProviderConfig): boolean {
  return config?.openAIApiMode === 'responses';
}

function responseInput(messages: LoopMessage[]): unknown[] {
  const input: unknown[] = [];

  for (const message of messages) {
    if (message.role === 'system' || message.role === 'user') {
      input.push({ role: message.role, content: message.content });
      continue;
    }

    if (message.role === 'assistant') {
      for (const item of message.providerContext ?? []) input.push(item);
      if (message.content) {
        input.push({ role: 'assistant', content: message.content });
      }
      for (const toolUse of message.toolUse ?? []) {
        input.push({
          type: 'function_call',
          call_id: toolUse.id,
          name: encodeToolIdForWire(toolUse.name),
          arguments: JSON.stringify(toolUse.input),
        });
      }
      continue;
    }

    if (message.role === 'tool' && message.toolUseId) {
      input.push({
        type: 'function_call_output',
        call_id: message.toolUseId,
        output: message.content,
      });
    }
  }

  return input;
}

function responseTools(
  config: ProviderConfig,
  tools: OpenAIToolDescriptor[],
): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = tools.map((tool) => ({
    type: 'function',
    name: tool.id,
    description: tool.description,
    parameters: tool.parameters,
    strict: false,
  }));

  if (config.hostedWebSearch) result.push(HOSTED_WEB_SEARCH_TOOL);
  return result;
}

export function buildOpenAIResponsesToolBody(
  messages: LoopMessage[],
  config: ProviderConfig,
  params: ChatParams,
  tools: OpenAIToolDescriptor[],
): Record<string, unknown> {
  const configuredTools = responseTools(config, tools);
  const body: Record<string, unknown> = {
    model: params.modelId,
    input: responseInput(messages),
    stream: true,
    store: false,
  };

  if (params.maxTokens !== undefined) body.max_output_tokens = params.maxTokens;
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (config.reasoningEffort) body.reasoning = { effort: config.reasoningEffort };
  if (configuredTools.length > 0) body.tools = configuredTools;
  const include = ['reasoning.encrypted_content'];
  if (config.hostedWebSearch) include.push('web_search_call.action.sources');
  body.include = include;

  return body;
}

export function buildOpenAIResponsesChatBody(
  messages: ChatMessage[],
  config: ProviderConfig,
  params: ChatParams,
): Record<string, unknown> {
  const loopMessages: LoopMessage[] = [];
  const systemPrompt = params.systemPrompt?.trim();
  if (systemPrompt) loopMessages.push({ role: 'system', content: systemPrompt });

  loopMessages.push(
    ...messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role, content: message.content }) as LoopMessage),
  );

  return buildOpenAIResponsesToolBody(loopMessages, config, params, []);
}

function parseSSEBlock(block: string): JsonObject | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim();

  if (!data || data === '[DONE]') return null;
  try {
    return JSON.parse(data) as JsonObject;
  } catch {
    return null;
  }
}

async function* responseEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<JsonObject> {
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const event = parseSSEBlock(block);
      if (event) yield event;
    }
  }

  buffer += decoder.decode();
  const event = parseSSEBlock(buffer);
  if (event) yield event;
}

function throwIfResponseFailed(event: JsonObject): void {
  const type = event.type;
  if (type !== 'error' && type !== 'response.failed') return;

  const response = event.response as JsonObject | undefined;
  const error = (event.error ?? response?.error) as JsonObject | string | undefined;
  const message =
    typeof error === 'string'
      ? error
      : typeof error?.message === 'string'
        ? error.message
        : 'OpenAI Responses request failed.';
  throw new Error(message);
}

export async function* parseOpenAIResponsesStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<ChatStreamEvent> {
  for await (const event of responseEvents(reader)) {
    throwIfResponseFailed(event);
    if (
      event.type === 'response.web_search_call.in_progress' ||
      event.type === 'response.web_search_call.searching'
    ) {
      yield { type: 'status', status: 'searching' };
      continue;
    }
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      yield event.delta;
    }
  }
}

export async function* parseOpenAIResponsesToolStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<ToolStreamEvent> {
  for await (const event of responseEvents(reader)) {
    throwIfResponseFailed(event);

    if (
      event.type === 'response.web_search_call.in_progress' ||
      event.type === 'response.web_search_call.searching'
    ) {
      yield { type: 'status', status: 'searching' };
      continue;
    }

    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      yield { type: 'text', text: event.delta };
      continue;
    }

    if (event.type === 'response.output_item.done') {
      const item = event.item as JsonObject | undefined;
      if (item?.type === 'reasoning') {
        yield { type: 'provider_context', item };
        continue;
      }
      if (item?.type === 'function_call') {
        let input: unknown = {};
        if (typeof item.arguments === 'string') {
          try {
            input = JSON.parse(item.arguments);
          } catch {
            /* keep the normalized empty input on malformed arguments */
          }
        }

        const id =
          typeof item.call_id === 'string'
            ? item.call_id
            : typeof item.id === 'string'
              ? item.id
              : '';
        const name = typeof item.name === 'string' ? item.name : '';
        yield { type: 'tool_use', id, name, input };
      }
      continue;
    }

    if (event.type === 'response.completed' || event.type === 'response.incomplete') {
      yield { type: 'message_stop' };
      return;
    }
  }

  yield { type: 'message_stop' };
}
