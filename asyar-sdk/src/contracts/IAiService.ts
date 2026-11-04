import type { WebSearchEngineRegistration } from './webSearch';
import type { AiProviderRegistration } from './aiProvider';

export interface AiCompletionOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface AiStreamOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
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
   * Registers a web search engine handler for this extension worker.
   * Can only be called from a worker context (`role: 'worker'`).
   * The `engine.id` must match a `webSearchEngines[].id` declared in `manifest.json`.
   * Returns a cleanup function that unregisters the handler.
   */
  registerWebSearchEngine(engine: WebSearchEngineRegistration): () => void;

  /**
   * Registers an AI model & inference provider handler for this extension worker.
   * Can only be called from a worker context (`role: 'worker'`).
   * The `provider.id` must match an `aiProviders[].id` declared in `manifest.json`.
   * Returns a cleanup function that unregisters the handler.
   */
  registerAiProvider(provider: AiProviderRegistration): () => void;
}
