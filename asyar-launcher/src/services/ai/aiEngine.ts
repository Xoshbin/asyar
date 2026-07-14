import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { StreamEventPayload } from '../../bindings';
import type {
  IProviderPlugin,
  ProviderConfig,
  ChatParams,
  ChatMessage,
  ChatStreamStatus,
} from './IProviderPlugin';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StreamHandlers {
  onToken: (token: string) => void;
  onStatus?: (status: ChatStreamStatus | null) => void;
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

const DEFAULT_TIMEOUT_MS = 30_000;
const HOSTED_WEB_SEARCH_TIMEOUT_MS = 120_000;

export function requestTimeoutMs(config: ProviderConfig): number {
  return config.hostedWebSearch ? HOSTED_WEB_SEARCH_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}

export function resolveChatParams(messages: ChatMessage[], params: ChatParams): ChatParams {
  if (params.systemPrompt?.trim()) return params;

  const systemPrompt = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n');

  return systemPrompt ? { ...params, systemPrompt } : params;
}

/**
 * Provider-agnostic streaming engine.
 * Delegates streaming and SSE parsing to the Rust Tauri command.
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

  const controller = new AbortController();
  activeControllers.set(streamId, controller);

  // Setup abort handling
  const onExternalAbort = () => controller.abort();
  signal.addEventListener('abort', onExternalAbort, { once: true });

  let resolveStream: () => void;
  const streamFinishedPromise = new Promise<void>((resolve) => {
    resolveStream = resolve;
  });

  const unlistenPromise = listen('ai-stream-event', (event) => {
    const payload = event.payload as StreamEventPayload;
    if (payload.streamId !== streamId) return;

    if (controller.signal.aborted) return;

    const ev = payload.event;
    if (ev.type === 'token') {
      handlers.onToken(ev.token);
    } else if (ev.type === 'status') {
      handlers.onStatus?.(ev.status as any);
    } else if (ev.type === 'done') {
      resolveStream();
    } else if (ev.type === 'error') {
      handlers.onError(ev.error);
      resolveStream();
    }
  });

  controller.signal.addEventListener('abort', () => resolveStream(), { once: true });

  try {
    const resolved = resolveChatParams(messages, params);

    await invoke('ai_stream_chat', {
      providerId: plugin.id,
      config,
      messages,
      params: resolved,
      streamId,
    });

    await streamFinishedPromise;

    if (!signal.aborted) {
      handlers.onDone();
    }
  } catch (err: any) {
    if (signal.aborted) {
      handlers.onDone();
    } else {
      handlers.onError(err?.message ?? 'Unknown error');
    }
  } finally {
    signal.removeEventListener('abort', onExternalAbort);
    activeControllers.delete(streamId);
    unlistenPromise.then((unlisten) => unlisten());
  }
}
