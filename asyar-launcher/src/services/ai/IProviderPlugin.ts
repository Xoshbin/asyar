// ─── Shared Types ─────────────────────────────────────────────────────────────

export type ProviderId = 'openai' | 'anthropic' | 'google' | 'ollama' | 'openrouter' | 'custom';
export type OpenAIApiMode = 'responses' | 'chat-completions';
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModelInfo {
  id: string;
  label: string;
  reasoningEfforts?: ReasoningEffort[];
}

export interface ProviderConfig {
  enabled: boolean;
  name?: string;
  providerType?: ProviderId;
  apiKey?: string;
  baseUrl?: string;
  lastModelId?: string;
  openAIApiMode?: OpenAIApiMode;
  hostedWebSearch?: boolean;
  reasoningEffort?: ReasoningEffort;
}

export type ChatStreamStatus = 'searching';

// ─── Tool calling types ────────────────────────────────────────────────────────

/** A normalized persisted tool-call payload rendered by the agent UI. */
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
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

  readonly supportsOpenAIApiMode?: boolean;
  readonly supportsHostedWebSearch?: boolean;
  readonly reasoningEfforts?: readonly ReasoningEffort[];

  getModels(config: ProviderConfig): Promise<ModelInfo[]>;
}
