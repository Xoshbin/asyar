export type AIRole = 'system' | 'user' | 'assistant';

export interface AIMessage {
  role: AIRole;
  content: string;
}

export interface AIStreamParams {
  /**
   * Full messages array. Include system messages here — the user's global
   * AI system prompt is NOT auto-injected into extension calls.
   */
  messages: AIMessage[];
  /**
   * Sampling temperature (0..2). Defaults to the user's configured value.
   */
  temperature?: number;
  /**
   * Max completion tokens. Clamped to the user's configured ceiling.
   */
  maxTokens?: number;
}

export type AIErrorCode =
  | 'ai_not_configured'    // No AI provider set up in launcher settings
  | 'ai_disabled_by_user'  // Master "Allow extensions to use AI" toggle is off
  | 'provider_error'       // Provider API error (bad key, rate limit, network, etc)
  | 'invalid_request'      // Malformed payload
  | 'internal_error'       // Unexpected host failure
  | 'aborted';             // handle.abort() was called

export interface AIError {
  code: AIErrorCode;
  message: string;
}

export interface AIStreamHandlers {
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (error: AIError) => void;
}

export interface AIStreamHandle {
  /** Abort the in-flight stream. No-op if already completed. */
  abort(): void;
}

/**
 * Stream text completions from the user's configured AI provider.
 *
 * Requires `"ai:use"` in the extension's manifest `permissions` array.
 *
 * The user's own API key is used. The extension never sees the key.
 * Calls count against the user's own provider limits.
 *
 * @example
 * ```ts
 * const handle = ctx.proxies.ai.stream(
 *   {
 *     messages: [
 *       { role: 'system', content: 'Translate to French. Reply only with the translation.' },
 *       { role: 'user', content: selectedText },
 *     ],
 *     temperature: 0.1,
 *   },
 *   {
 *     onToken: (t) => (output += t),
 *     onDone: () => ctx.proxies.feedback.showHUD({ title: 'Done' }),
 *     onError: (e) => ctx.proxies.feedback.showToast({ title: e.message, style: 'failure' }),
 *   },
 * );
 * // Abort if needed:
 * handle.abort();
 * ```
 */
export interface IAIService {
  stream(params: AIStreamParams, handlers: AIStreamHandlers): AIStreamHandle;
}
