/**
 * Contracts for the AI Model & Inference Providers SPI (aiProviders).
 * Allows Tier 2 extensions to contribute custom LLM inference engines to Asyar.
 */

export interface AiToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface AiMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: AiToolCall[];
  toolCallId?: string;
}

export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AiCompletionRequest {
  messages: AiMessage[];
  modelId: string;
  temperature?: number;
  maxTokens: number;
  systemPrompt?: string;
  tools?: AiToolDefinition[];
  apiKey?: string;
  baseUrl?: string;
  customHeaders?: Record<string, string>;
}

export type AiStreamChunk =
  | { type: 'token'; token: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'status'; status: string };

export interface AiModelInfo {
  id: string;
  label: string;
  contextWindow?: number;
  reasoningEfforts?: string[];
}

export interface AiProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  customHeaders?: Record<string, string>;
}

export type AiStreamCallback = (chunk: AiStreamChunk) => void;

export type AiProviderCompleteStream = (
  request: AiCompletionRequest,
  onChunk: AiStreamCallback,
  signal: AbortSignal,
) => Promise<void>;

export type AiProviderListModels = (
  config: AiProviderConfig,
  signal: AbortSignal,
) => Promise<AiModelInfo[]>;

export interface AiProviderRegistration {
  /**
   * Provider identifier. Must match an id declared in manifest.aiProviders.
   */
  id: string;
  /**
   * Streaming completion handler executed in the extension worker.
   */
  completeStream: AiProviderCompleteStream;
  /**
   * Optional dynamic model listing handler.
   */
  listModels?: AiProviderListModels;
}

/**
 * Manifest model declaration shape.
 */
export interface ManifestAiModel {
  id: string;
  name: string;
  contextWindow?: number;
  reasoningEfforts?: string[];
}

/**
 * Manifest declaration shape for a contributed AI provider.
 */
export interface ManifestAiProvider {
  id: string;
  name: string;
  description?: string;
  homepage?: string;
  requiresApiKey?: boolean;
  apiKeyOptional?: boolean;
  apiKeyPlaceholder?: string;
  apiKeyHelpUrl?: string;
  requiresBaseUrl?: boolean;
  baseUrlPlaceholder?: string;
  models?: ManifestAiModel[];
}
