/**
 * Browser-only Tier 2 AI inference provider dispatch bridge.
 * Dispatches streaming chat completion requests and dynamic model listing to extension worker contexts.
 */
import { pickExtensionIframe } from './extensionIframeSelector';
import { postToExtension } from './extensionDelivery';
import { workerHost } from './workerHost.svelte';
import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';
import {
  TIER2_AI_PROVIDER_CHUNK_TYPE,
  TIER2_AI_PROVIDER_COMPLETE_TYPE,
  TIER2_AI_PROVIDER_ERROR_TYPE,
  TIER2_AI_PROVIDER_LIST_MODELS_RESPONSE_TYPE,
} from '../../lib/ipc/extensionMessageProtocol';
import type {
  AiCompletionRequest,
  AiStreamChunk,
  AiModelInfo,
  AiProviderConfig,
} from 'asyar-sdk/contracts';

let messageIdCounter = 0;

interface PendingStream {
  type: 'stream';
  source: MessageEventSource | object;
  expectedOrigin: string;
  onChunk: (chunk: AiStreamChunk) => void;
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface PendingListModels {
  type: 'listModels';
  source: MessageEventSource | object;
  expectedOrigin: string;
  resolve: (models: AiModelInfo[]) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

type PendingEntry = PendingStream | PendingListModels;

const pendingRequests = new Map<string, PendingEntry>();
let responseListenerInstalled = false;

function removePending(messageId: string): PendingEntry | undefined {
  const pending = pendingRequests.get(messageId);
  if (!pending) return undefined;
  pendingRequests.delete(messageId);
  if (pending.signal && pending.onAbort) {
    pending.signal.removeEventListener('abort', pending.onAbort);
  }
  return pending;
}

/** Consumes both window messages and authenticated worker pipeline messages. */
export function handleAiProviderResponse(event: MessageEvent): void {
  const message = event.data as Record<string, unknown> | null;
  if (!message || typeof message !== 'object') return;
  const msgType = message.type;
  if (
    msgType !== TIER2_AI_PROVIDER_CHUNK_TYPE &&
    msgType !== TIER2_AI_PROVIDER_COMPLETE_TYPE &&
    msgType !== TIER2_AI_PROVIDER_ERROR_TYPE &&
    msgType !== TIER2_AI_PROVIDER_LIST_MODELS_RESPONSE_TYPE
  ) {
    return;
  }
  const messageId = typeof message.messageId === 'string' ? message.messageId : null;
  if (!messageId) return;

  const pending = pendingRequests.get(messageId);
  if (!pending || event.source !== pending.source) return;
  if (pending.expectedOrigin !== '*' && event.origin !== pending.expectedOrigin) return;

  if (pending.type === 'stream') {
    if (msgType === TIER2_AI_PROVIDER_CHUNK_TYPE) {
      if (message.chunk && typeof message.chunk === 'object') {
        pending.onChunk(message.chunk as AiStreamChunk);
      }
      return;
    }
    removePending(messageId);
    if (msgType === TIER2_AI_PROVIDER_ERROR_TYPE) {
      pending.reject(new Error(String(message.error ?? 'Extension AI provider error')));
    } else if (msgType === TIER2_AI_PROVIDER_COMPLETE_TYPE) {
      pending.resolve();
    }
  } else if (pending.type === 'listModels') {
    removePending(messageId);
    if ('error' in message) {
      pending.reject(new Error(String(message.error)));
    } else {
      pending.resolve(Array.isArray(message.models) ? (message.models as AiModelInfo[]) : []);
    }
  }
}

function ensureResponseListener(): void {
  if (responseListenerInstalled) return;
  responseListenerInstalled = true;
  window.addEventListener('message', handleAiProviderResponse);
}

export async function invokeExtensionAiProviderStream(
  extensionId: string,
  providerId: string,
  request: AiCompletionRequest,
  onChunk: (chunk: AiStreamChunk) => void,
  signal?: AbortSignal,
): Promise<void> {
  const worker = workerHost.getWorker(extensionId);
  const targetWindow = worker
    ? (worker.rawWorker ?? worker)
    : pickExtensionIframe(extensionId, 'worker')?.contentWindow;
  if (!targetWindow) {
    throw new Error(
      `invokeExtensionAiProviderStream: extension '${extensionId}' worker is not mounted`,
    );
  }
  if (signal?.aborted) throw new Error('Extension AI provider dispatch was cancelled');

  const messageId = `aistream-${++messageIdCounter}-${Date.now()}`;
  const expectedOrigin = worker
    ? `asyar-extension://${extensionId}`
    : getExtensionFrameOrigin(extensionId);
  ensureResponseListener();

  return new Promise<void>((resolve, reject) => {
    const onAbort = signal
      ? () => {
          if (!removePending(messageId)) return;
          try {
            postToExtension(extensionId, 'worker', {
              type: 'asyar:aiProvider:abort',
              messageId,
            });
          } catch {
            // best effort abort notification
          }
          reject(new Error('Extension AI provider dispatch was cancelled'));
        }
      : undefined;

    pendingRequests.set(messageId, {
      type: 'stream',
      source: targetWindow,
      expectedOrigin,
      onChunk,
      resolve,
      reject,
      signal,
      onAbort,
    });
    signal?.addEventListener('abort', onAbort!, { once: true });

    try {
      const delivered = postToExtension(extensionId, 'worker', {
        type: 'asyar:aiProvider:streamRequest',
        messageId,
        providerId,
        payload: request,
      });
      if (!delivered) {
        removePending(messageId);
        reject(
          new Error(
            `invokeExtensionAiProviderStream: extension '${extensionId}' worker is not mounted`,
          ),
        );
      }
    } catch (error) {
      removePending(messageId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export async function invokeExtensionAiProviderListModels(
  extensionId: string,
  providerId: string,
  config: AiProviderConfig,
  signal?: AbortSignal,
): Promise<AiModelInfo[]> {
  const worker = workerHost.getWorker(extensionId);
  const targetWindow = worker
    ? (worker.rawWorker ?? worker)
    : pickExtensionIframe(extensionId, 'worker')?.contentWindow;
  if (!targetWindow) {
    throw new Error(
      `invokeExtensionAiProviderListModels: extension '${extensionId}' worker is not mounted`,
    );
  }
  if (signal?.aborted) throw new Error('Extension AI provider listModels was cancelled');

  const messageId = `aimodels-${++messageIdCounter}-${Date.now()}`;
  const expectedOrigin = worker
    ? `asyar-extension://${extensionId}`
    : getExtensionFrameOrigin(extensionId);
  ensureResponseListener();

  return new Promise<AiModelInfo[]>((resolve, reject) => {
    const onAbort = signal
      ? () => {
          if (!removePending(messageId)) return;
          reject(new Error('Extension AI provider listModels was cancelled'));
        }
      : undefined;

    pendingRequests.set(messageId, {
      type: 'listModels',
      source: targetWindow,
      expectedOrigin,
      resolve,
      reject,
      signal,
      onAbort,
    });
    signal?.addEventListener('abort', onAbort!, { once: true });

    try {
      const delivered = postToExtension(extensionId, 'worker', {
        type: 'asyar:aiProvider:listModels',
        messageId,
        providerId,
        config,
      });
      if (!delivered) {
        removePending(messageId);
        reject(
          new Error(
            `invokeExtensionAiProviderListModels: extension '${extensionId}' worker is not mounted`,
          ),
        );
      }
    } catch (error) {
      removePending(messageId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
