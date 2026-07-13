import { fetch } from '@tauri-apps/plugin-http';
import { encodeToolIdForWire } from '../IProviderPlugin';
import type {
  IProviderPlugin,
  ModelInfo,
  ProviderConfig,
  RequestSpec,
  ChatParams,
  ChatMessage,
  LoopMessage,
  ToolStreamEvent,
  ReasoningEffort,
} from '../IProviderPlugin';

const GEMINI_25_EFFORTS: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high'];
const GEMINI_3_EFFORTS: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high'];
const GEMINI_3_PRO_EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high'];
const GEMINI_3_LEGACY_PRO_EFFORTS: ReasoningEffort[] = ['low', 'high'];
const GEMINI_3_IMAGE_EFFORTS: ReasoningEffort[] = ['minimal', 'high'];
const GEMINI_25_BUDGETS: Partial<Record<ReasoningEffort, number>> = {
  minimal: 1024,
  low: 1024,
  medium: 8192,
  high: 24576,
};

function geminiMajor(modelId: string): number | null {
  const match = /^gemini-(\d+)/.exec(modelId);
  return match ? Number(match[1]) : null;
}

export function googleReasoningEfforts(modelId: string): ReasoningEffort[] {
  if (modelId.startsWith('gemini-2.5')) return [...GEMINI_25_EFFORTS];

  const major = geminiMajor(modelId);
  if (major === null || major < 3) return [];
  if (modelId.includes('-image')) return [...GEMINI_3_IMAGE_EFFORTS];
  if (modelId.startsWith('gemini-3-pro')) return [...GEMINI_3_LEGACY_PRO_EFFORTS];
  if (modelId.includes('-pro')) return [...GEMINI_3_PRO_EFFORTS];
  return [...GEMINI_3_EFFORTS];
}

export function googleThinkingConfig(
  modelId: string,
  effort: ReasoningEffort | undefined,
): Record<string, unknown> | undefined {
  if (!effort) return undefined;

  if (modelId.startsWith('gemini-2.5')) {
    const thinkingBudget = GEMINI_25_BUDGETS[effort];
    return thinkingBudget === undefined ? undefined : { thinkingBudget };
  }

  const supportedEfforts = googleReasoningEfforts(modelId);
  const thinkingLevel =
    effort === 'minimal' && !supportedEfforts.includes('minimal')
      ? 'low'
      : supportedEfforts.includes(effort)
        ? effort
        : undefined;
  return thinkingLevel ? { thinkingLevel } : undefined;
}

export const googlePlugin: IProviderPlugin = {
  id: 'google',
  name: 'Google Gemini',
  requiresApiKey: true,
  requiresBaseUrl: false,
  supportsTools: true,
  reasoningEfforts: ['minimal', 'low', 'medium', 'high'],

  async getModels(config: ProviderConfig): Promise<ModelInfo[]> {
    // Security fix: API key in Authorization header, NOT in URL
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: {
        'x-goog-api-key': config.apiKey ?? '',
      },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }>;
    };
    return (json.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .filter((m) => m.name.includes('gemini'))
      .map((m) => ({
        id: m.name.replace('models/', ''),
        label: m.displayName ?? m.name.replace('models/', ''),
        reasoningEfforts: googleReasoningEfforts(m.name.replace('models/', '')),
      }));
  },

  buildRequest(messages: ChatMessage[], config: ProviderConfig, params: ChatParams): RequestSpec {
    const filtered = messages.filter((m) => m.role !== 'system');
    const contents = filtered.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const thinkingConfig = googleThinkingConfig(params.modelId, config.reasoningEffort);
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${params.modelId}:streamGenerateContent?alt=sse`,
      headers: {
        'Content-Type': 'application/json',
        // API key in header, not URL (security fix)
        'x-goog-api-key': config.apiKey ?? '',
      },
      body: {
        contents,
        generationConfig: {
          temperature: params.temperature,
          maxOutputTokens: params.maxTokens,
          ...(thinkingConfig && { thinkingConfig }),
        },
      },
    };
  },

  buildToolRequest(
    messages: LoopMessage[],
    config: ProviderConfig,
    params: ChatParams,
    tools: Array<{
      id: string;
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>,
  ): RequestSpec {
    // Gemini requires `name` in functionResponse; look up from prior assistant turn's functionCall.
    // `tu.name` holds the original FQID (e.g. `builtin:calculator`), not the
    // wire-safe form — encode it here so historical function calls/responses
    // match the wire-safe names declared in `functionDeclarations` below.
    const idToName = new Map<string, string>();
    for (const m of messages) {
      if (m.role === 'assistant' && Array.isArray(m.toolUse)) {
        for (const tu of m.toolUse) idToName.set(tu.id, encodeToolIdForWire(tu.name));
      }
    }

    let systemText = '';
    const contents: Array<{ role: string; parts: unknown[] }> = [];

    for (const m of messages) {
      if (m.role === 'system') {
        systemText = m.content;
        continue;
      }
      if (m.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: m.content }] });
        continue;
      }
      if (m.role === 'assistant') {
        const parts: unknown[] = [];
        if (m.content) parts.push({ text: m.content });
        if (Array.isArray(m.toolUse)) {
          for (const tu of m.toolUse) {
            parts.push({
              functionCall: { id: tu.id, name: encodeToolIdForWire(tu.name), args: tu.input },
            });
          }
        }
        contents.push({ role: 'model', parts });
        continue;
      }
      if (m.role === 'tool') {
        const id = m.toolUseId ?? '';
        const name = idToName.get(id) ?? '';
        let output: unknown = m.content;
        try {
          output = JSON.parse(m.content);
        } catch {
          /* leave as string */
        }
        contents.push({
          role: 'user',
          parts: [{ functionResponse: { id, name, response: { output } } }],
        });
        continue;
      }
    }

    const thinkingConfig = googleThinkingConfig(params.modelId, config.reasoningEffort);
    const body: Record<string, unknown> = {
      contents,
      tools: [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.id,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ],
      generationConfig: {
        ...(params.temperature !== undefined && { temperature: params.temperature }),
        ...(params.maxTokens !== undefined && { maxOutputTokens: params.maxTokens }),
        ...(thinkingConfig && { thinkingConfig }),
      },
    };
    if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };

    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${params.modelId}:streamGenerateContent?alt=sse`,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.apiKey ?? '',
      },
      body,
    };
  },

  async *parseToolStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): AsyncGenerator<ToolStreamEvent> {
    const decoder = new TextDecoder();
    let buffer = '';
    let toolCounter = 0;
    let stopped = false;

    while (!stopped) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIdx;
      while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
        const eventChunk = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        for (const line of eventChunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice('data: '.length).trim();
          if (!payload) continue;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let parsed: any;
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }
          const candidate = parsed?.candidates?.[0];
          const parts = candidate?.content?.parts;
          if (Array.isArray(parts)) {
            for (const part of parts) {
              if (typeof part?.text === 'string' && part.text !== '') {
                yield { type: 'text', text: part.text };
              } else if (part?.functionCall) {
                const fc = part.functionCall;
                const id = typeof fc.id === 'string' && fc.id ? fc.id : `gemini-${++toolCounter}`;
                yield {
                  type: 'tool_use',
                  id,
                  name: fc.name,
                  input: fc.args ?? {},
                };
              }
            }
          }
          if (candidate?.finishReason) {
            stopped = true;
          }
        }
      }
    }
    yield { type: 'message_stop' };
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
          const token = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (token) yield token;
        } catch {
          /* skip malformed */
        }
      }
    }
  },
};
