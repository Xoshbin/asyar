import type { WebSearchEngineRegistration } from './webSearch';
import type { WebReaderEngineRegistration } from './webReader';
import type { AiProviderRegistration } from './aiProvider';

/**
 * Reference to a specific configured AI provider and model.
 * Matches the value shape stored by `aiModel` preferences and accepted by
 * `ai.complete()` / `ai.stream()`.
 */
export interface AiModelRef {
  providerId: string;
  modelId: string;
}

/** Returns true when `value` is an `{ providerId, modelId }` object with non-empty strings. */
export function isValidAiModelRef(value: unknown): value is AiModelRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ref = value as Record<string, unknown>;
  return (
    typeof ref.providerId === 'string' &&
    ref.providerId.trim().length > 0 &&
    typeof ref.modelId === 'string' &&
    ref.modelId.trim().length > 0
  );
}

/**
 * A configured AI model available to extensions via `ai.listModels()`.
 */
export interface AiConfiguredModel extends AiModelRef {
  providerName: string;
  label: string;
  isDefault: boolean;
}

export interface AiCompletionOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  model?: AiModelRef;
  signal?: AbortSignal;
}

export interface AiStreamOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  model?: AiModelRef;
  signal?: AbortSignal;
}

export interface IAiService {
  complete(prompt: string, options?: AiCompletionOptions): Promise<string>;
  stream(
    prompt: string,
    onChunk: (delta: string) => void,
    options?: AiStreamOptions,
  ): Promise<string>;

  /**
   * Lists the AI models currently available from configured, enabled providers.
   * Requires the `"ai"` permission.
   */
  listModels(): Promise<AiConfiguredModel[]>;

  /**
   * Registers a web search engine handler for this extension worker.
   * Can only be called from a worker context (`role: 'worker'`).
   * The `engine.id` must match a `webSearchEngines[].id` declared in `manifest.json`.
   * Returns a cleanup function that unregisters the handler.
   */
  registerWebSearchEngine(engine: WebSearchEngineRegistration): () => void;

  /**
   * Registers a web reader/scraper handler for this extension worker.
   * Can only be called from a worker context (`role: 'worker'`).
   * The `engine.id` must match a `webReaders[].id` declared in `manifest.json`.
   * Returns a cleanup function that unregisters the handler.
   */
  registerWebReader(engine: WebReaderEngineRegistration): () => void;

  /**
   * Registers an AI model & inference provider handler for this extension worker.
   * Can only be called from a worker context (`role: 'worker'`).
   * The `provider.id` must match an `aiProviders[].id` declared in `manifest.json`.
   * Returns a cleanup function that unregisters the handler.
   */
  registerAiProvider(provider: AiProviderRegistration): () => void;
}
