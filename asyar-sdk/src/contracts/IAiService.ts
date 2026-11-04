import type { WebSearchEngineRegistration } from './webSearch';

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
}
