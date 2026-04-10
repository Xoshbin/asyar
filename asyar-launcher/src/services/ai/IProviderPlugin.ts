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

// ─── Provider Plugin Interface ─────────────────────────────────────────────────

export interface IProviderPlugin {
  readonly id: ProviderId;
  readonly name: string;
  readonly requiresApiKey: boolean;
  readonly requiresBaseUrl: boolean;

  getModels(config: ProviderConfig): Promise<ModelInfo[]>;
  buildRequest(messages: ChatMessage[], config: ProviderConfig, params: ChatParams): RequestSpec;
  parseStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<string>;
}
