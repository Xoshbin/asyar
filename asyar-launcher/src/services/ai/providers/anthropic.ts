import type { IProviderPlugin, ModelInfo, ProviderConfig, RequestSpec, ChatParams, ChatMessage, LoopMessage, ToolStreamEvent } from '../IProviderPlugin';

export const anthropicPlugin: IProviderPlugin = {
  id: 'anthropic',
  name: 'Anthropic',
  requiresApiKey: true,
  requiresBaseUrl: false,
  supportsTools: true,

  async getModels(config: ProviderConfig): Promise<ModelInfo[]> {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: {
        'x-api-key': config.apiKey ?? '',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });
    if (!res.ok) return [];
    const json = await res.json() as { data?: Array<{ id: string; display_name?: string }> };
    return (json.data ?? []).map((m) => ({ id: m.id, label: m.display_name ?? m.id }));
  },

  buildRequest(messages: ChatMessage[], config: ProviderConfig, params: ChatParams): RequestSpec {
    const systemPrompt = params.systemPrompt?.trim() || 'You are a helpful assistant.';
    const filtered = messages.filter((m) => m.role !== 'system');
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey ?? '',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      // `temperature` is intentionally omitted: Anthropic deprecated it for
      // newer Claude 4.x models (Haiku 4.5+) and rejects requests with a 400
      // when the field is present. The model's default sampling is used.
      body: {
        model: params.modelId,
        max_tokens: params.maxTokens,
        system: systemPrompt,
        stream: true,
        messages: filtered.map((m) => ({ role: m.role, content: m.content })),
      },
    };
  },

  async *parseStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<string> {
    const decoder = new TextDecoder();
    let buffer = '';
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
        try {
          const json = JSON.parse(data);
          if (json.type === 'content_block_delta') {
            const token = json.delta?.text;
            if (token) yield token;
          }
        } catch { /* skip malformed */ }
      }
    }
  },

  buildToolRequest(
    messages: LoopMessage[],
    config: ProviderConfig,
    params: ChatParams,
    tools: Array<{ id: string; name: string; description: string; parameters: Record<string, unknown> }>,
  ): RequestSpec {
    // Extract system message from loop messages (if any)
    const systemMsg = messages.find((m) => m.role === 'system');
    const systemPrompt = systemMsg?.content?.trim() || 'You are a helpful assistant.';

    // Convert LoopMessage[] to Anthropic API message format
    const anthropicMessages: unknown[] = [];
    for (const msg of messages) {
      if (msg.role === 'system') continue;

      if (msg.role === 'user') {
        anthropicMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const contentBlocks: unknown[] = [];
        if (msg.content) {
          contentBlocks.push({ type: 'text', text: msg.content });
        }
        if (msg.toolUse && msg.toolUse.length > 0) {
          for (const tu of msg.toolUse) {
            contentBlocks.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
          }
        }
        anthropicMessages.push({ role: 'assistant', content: contentBlocks });
      } else if (msg.role === 'tool') {
        anthropicMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolUseId,
              content: msg.content,
            },
          ],
        });
      }
    }

    // Convert tool descriptors to Anthropic tool format
    const anthropicTools = tools.map((t) => ({
      name: t.id,
      description: t.description,
      input_schema: t.parameters,
    }));

    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey ?? '',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      // `temperature` omitted — Anthropic deprecated it on newer Claude 4.x
      // models and rejects with 400 when present. See `buildRequest` above.
      body: {
        model: params.modelId,
        max_tokens: params.maxTokens,
        system: systemPrompt,
        stream: true,
        tools: anthropicTools,
        messages: anthropicMessages,
      },
    };
  },

  async *parseToolStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<ToolStreamEvent> {
    const decoder = new TextDecoder();
    let buffer = '';

    // Current block being accumulated
    let currentBlockType: 'text' | 'tool_use' | null = null;
    let currentToolId = '';
    let currentToolName = '';
    let currentToolJsonAccum = '';

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
        try {
          const json = JSON.parse(data) as Record<string, unknown>;

          if (json.type === 'content_block_start') {
            const block = json.content_block as Record<string, unknown> | undefined;
            if (block?.type === 'text') {
              currentBlockType = 'text';
            } else if (block?.type === 'tool_use') {
              currentBlockType = 'tool_use';
              currentToolId = (block.id as string) ?? '';
              currentToolName = (block.name as string) ?? '';
              currentToolJsonAccum = '';
            }
          } else if (json.type === 'content_block_delta') {
            const delta = json.delta as Record<string, unknown> | undefined;
            if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
              yield { type: 'text', text: delta.text };
            } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
              currentToolJsonAccum += delta.partial_json;
            }
          } else if (json.type === 'content_block_stop') {
            if (currentBlockType === 'tool_use') {
              let input: unknown = {};
              try {
                input = JSON.parse(currentToolJsonAccum || '{}');
              } catch { /* use empty object on parse failure */ }
              yield { type: 'tool_use', id: currentToolId, name: currentToolName, input };
            }
            currentBlockType = null;
          } else if (json.type === 'message_stop') {
            yield { type: 'message_stop' };
          }
        } catch { /* skip malformed SSE lines */ }
      }
    }
  },
};
