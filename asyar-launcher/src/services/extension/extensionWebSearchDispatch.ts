/**
 * Browser-only Tier 2 web search dispatch bridge.
 * Dispatches web search queries to extension worker contexts and awaits normalized search results.
 */
import { pickExtensionIframe } from './extensionIframeSelector';
import { postToExtension } from './extensionDelivery';
import { workerHost } from './workerHost.svelte';
import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';
import { TIER2_WEB_SEARCH_RESPONSE_TYPE } from '../../lib/ipc/extensionMessageProtocol';

let messageIdCounter = 0;

interface PendingResponse {
  source: MessageEventSource | object;
  expectedOrigin: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

const pendingResponses = new Map<string, PendingResponse>();
let responseListenerInstalled = false;

function removePending(messageId: string): PendingResponse | undefined {
  const pending = pendingResponses.get(messageId);
  if (!pending) return undefined;
  pendingResponses.delete(messageId);
  if (pending.signal && pending.onAbort) {
    pending.signal.removeEventListener('abort', pending.onAbort);
  }
  return pending;
}

/** Consumes both window messages and authenticated worker pipeline messages. */
export function handleWebSearchResponse(event: MessageEvent): void {
  const message = event.data as Record<string, unknown> | null;
  if (!message || typeof message !== 'object') return;
  if (message.type !== TIER2_WEB_SEARCH_RESPONSE_TYPE) return;
  const messageId = typeof message.messageId === 'string' ? message.messageId : null;
  if (!messageId) return;

  const pending = pendingResponses.get(messageId);
  if (!pending || event.source !== pending.source) return;
  if (pending.expectedOrigin !== '*' && event.origin !== pending.expectedOrigin) return;

  removePending(messageId);
  if ('error' in message) {
    pending.reject(new Error(String(message.error)));
  } else {
    pending.resolve(message.result);
  }
}

function ensureResponseListener(): void {
  if (responseListenerInstalled) return;
  responseListenerInstalled = true;
  window.addEventListener('message', handleWebSearchResponse);
}

export async function invokeExtensionWebSearch(
  extensionId: string,
  engineId: string,
  args: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const worker = workerHost.getWorker(extensionId);
  const targetWindow = worker
    ? (worker.rawWorker ?? worker)
    : pickExtensionIframe(extensionId, 'worker')?.contentWindow;
  if (!targetWindow) {
    throw new Error(`invokeExtensionWebSearch: extension '${extensionId}' worker is not mounted`);
  }
  if (signal?.aborted) throw new Error('Extension web search dispatch was cancelled');

  const messageId = `websearch-${++messageIdCounter}-${Date.now()}`;
  const expectedOrigin = worker
    ? `asyar-extension://${extensionId}`
    : getExtensionFrameOrigin(extensionId);
  ensureResponseListener();

  const queryPayload =
    typeof args === 'object' && args !== null
      ? { engineId, ...(args as Record<string, unknown>) }
      : { engineId, query: String(args) };

  return new Promise<unknown>((resolve, reject) => {
    const onAbort = signal
      ? () => {
          if (!removePending(messageId)) return;
          reject(new Error('Extension web search dispatch was cancelled'));
        }
      : undefined;
    pendingResponses.set(messageId, {
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
        type: 'asyar:webSearch:query',
        messageId,
        payload: queryPayload,
      });
      if (!delivered) {
        removePending(messageId);
        reject(
          new Error(`invokeExtensionWebSearch: extension '${extensionId}' worker is not mounted`),
        );
      }
    } catch (error) {
      removePending(messageId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
