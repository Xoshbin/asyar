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
}
