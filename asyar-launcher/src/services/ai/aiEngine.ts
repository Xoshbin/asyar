import { fetch } from '@tauri-apps/plugin-http';
import type { IProviderPlugin, ProviderConfig, ChatParams, ChatMessage } from './IProviderPlugin';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StreamHandlers {
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

// ─── Active stream controllers ────────────────────────────────────────────────

const activeControllers = new Map<string, AbortController>();

/** Cancel an in-flight stream by its ID. No-op if the id is not active. */
export function stopStream(streamId: string): void {
  const controller = activeControllers.get(streamId);
  if (controller) {
    controller.abort();
    activeControllers.delete(streamId);
  }
}

/** Test-only: clear all active streams without aborting. */
export function _clearAllStreamsForTesting(): void {
  activeControllers.clear();
}

// ─── Main stream function ─────────────────────────────────────────────────────

const TIMEOUT_MS = 30_000;

/**
 * Provider-agnostic streaming engine.
 * - 30 s timeout merged with external signal
 * - HTTP 429 → onError('rate_limited: ...')
 * - Non-2xx → reads error body, calls onError
 * - Stream failure mid-response → onError (partial tokens already delivered are kept)
 * - Clean abort (signal cancelled) → call onDone, NOT onError
 */
export async function streamChat(
  plugin: IProviderPlugin,
  config: ProviderConfig,
  messages: ChatMessage[],
  params: ChatParams,
  handlers: StreamHandlers,
  signal: AbortSignal,
  streamId: string,
): Promise<void> {
  if (!streamId) throw new Error('streamChat: streamId is required');
  if (activeControllers.has(streamId)) {
    throw new Error(`streamChat: streamId already active: ${streamId}`);
  }

  // Merge external signal + 30 s timeout
  const controller = new AbortController();
  activeControllers.set(streamId, controller);

  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  // When external signal aborts, forward to our controller
  const onExternalAbort = () => controller.abort();
  signal.addEventListener('abort', onExternalAbort, { once: true });

  const mergedSignal = controller.signal;

  try {
    const spec = plugin.buildRequest(messages, config, params);

    const response = await fetch(spec.url, {
      method: 'POST',
      headers: spec.headers,
      body: JSON.stringify(spec.body),
      signal: mergedSignal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => `HTTP ${response.status}`);
      let friendlyError: string;
      try {
        const errJson = JSON.parse(errorText);
        friendlyError = errJson.error?.message ?? errJson.message ?? errorText;
      } catch {
        friendlyError = errorText || `HTTP ${response.status}`;
      }

      if (response.status === 429) {
        handlers.onError(`rate_limited: ${friendlyError}`);
      } else {
        handlers.onError(`API error: ${friendlyError}`);
      }
      return;
    }

    if (!response.body) {
      handlers.onError('No response body received.');
      return;
    }

    const reader = response.body.getReader();

    try {
      for await (const token of plugin.parseStream(reader)) {
        if (mergedSignal.aborted) break;
        handlers.onToken(token);
      }
    } finally {
      reader.releaseLock();
    }

    if (!mergedSignal.aborted) {
      handlers.onDone();
    } else if (signal.aborted) {
      // External abort — call onDone (clean shutdown)
      handlers.onDone();
    }
    // else: timeout abort — let catch handle it
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') {
      // Clean abort (external signal or timeout)
      handlers.onDone();
    } else {
      handlers.onError((err as Error)?.message ?? 'Unknown error');
    }
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener('abort', onExternalAbort);
    activeControllers.delete(streamId);
  }
}
