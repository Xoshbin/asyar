// ─── Shared Types ─────────────────────────────────────────────────────────────

export type ProviderId = 'openai' | 'anthropic' | 'google' | 'ollama' | 'openrouter' | 'custom';

export interface ModelInfo {
  id: string;
  label: string;
}

export interface ProviderConfig {
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  lastModelId?: string;
}

export interface RequestSpec {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface ChatParams {
  modelId: string;
  temperature: number;
  maxTokens: number;
  systemPrompt?: string;
}

// ─── Message type expected by the provider's buildRequest ─────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

// ─── Tool calling types ────────────────────────────────────────────────────────

/**
 * Events emitted by `parseToolStream` during a tool-capable streaming response.
 */
export type ToolStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'message_stop' };

/**
 * A message in the multi-turn agent loop conversation.
 * - `user` / `assistant` / `system`: standard chat roles
 * - `tool`: carries a tool-result; requires `toolUseId` to correlate with the prior `assistant` tool_use block
 * - `toolUse`: only set on `assistant` messages that also called tools in the same turn
 */
export interface LoopMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolUse?: Array<{ id: string; name: string; input: unknown }>;
  toolUseId?: string;
}

// ─── Provider Plugin Interface ─────────────────────────────────────────────────

export interface IProviderPlugin {
  readonly id: ProviderId;
  readonly name: string;
  readonly requiresApiKey: boolean;
  /**
   * Field is rendered in the UI but not enforced — the provider can be used with
   * or without a key (e.g. an OpenAI-compatible endpoint that may or may not be
   * secured behind a Bearer token).
   */
  readonly optionalApiKey?: boolean;
  readonly requiresBaseUrl: boolean;

  /**
   * Whether this provider supports tool calling via `buildToolRequest` /
   * `parseToolStream`. Absent or `false` → text-only.
   */
  readonly supportsTools?: boolean;

  getModels(config: ProviderConfig): Promise<ModelInfo[]>;
  buildRequest(messages: ChatMessage[], config: ProviderConfig, params: ChatParams): RequestSpec;
  parseStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<string>;

  /**
   * Build the HTTP request for a tool-capable turn.
   * Only called when `supportsTools === true` and the agent has a non-empty
   * `toolSelection`.
   */
  buildToolRequest?(
    messages: LoopMessage[],
    config: ProviderConfig,
    params: ChatParams,
    tools: Array<{ id: string; name: string; description: string; parameters: Record<string, unknown> }>,
  ): RequestSpec;

  /**
   * Parse the SSE stream from a tool-capable response, yielding
   * `ToolStreamEvent` objects.
   */
  parseToolStream?(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<ToolStreamEvent>;
}
