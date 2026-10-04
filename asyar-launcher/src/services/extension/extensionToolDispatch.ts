/** Browser-only Tier 2 tool bridge. Tool routing and execution policy live in Rust. */
import { pickExtensionIframe } from './extensionIframeSelector';
import { postToExtension } from './extensionDelivery';
import { workerHost } from './workerHost.svelte';
import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';
import { TIER2_TOOL_RESPONSE_TYPE } from '../../lib/ipc/extensionMessageProtocol';

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
export function handleToolResponse(event: MessageEvent): void {
  const message = event.data as Record<string, unknown> | null;
  if (!message || typeof message !== 'object') return;
  if (message.type !== TIER2_TOOL_RESPONSE_TYPE) return;
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
  window.addEventListener('message', handleToolResponse);
}

export async function invokeExtensionTool(
  extensionId: string,
  toolId: string,
  args: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const worker = workerHost.getWorker(extensionId);
  const targetWindow = worker
    ? (worker.rawWorker ?? worker)
    : pickExtensionIframe(extensionId, 'worker')?.contentWindow;
  if (!targetWindow) {
    throw new Error(`invokeExtensionTool: extension '${extensionId}' worker is not mounted`);
  }
  if (signal?.aborted) throw new Error('Extension tool dispatch was cancelled');

  const messageId = `tool-${++messageIdCounter}-${Date.now()}`;
  const expectedOrigin = worker
    ? `asyar-extension://${extensionId}`
    : getExtensionFrameOrigin(extensionId);
  ensureResponseListener();

  return new Promise<unknown>((resolve, reject) => {
    const onAbort = signal
      ? () => {
          if (!removePending(messageId)) return;
          reject(new Error('Extension tool dispatch was cancelled'));
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
        type: 'asyar:tools:invoke',
        messageId,
        payload: { id: toolId, args },
      });
      if (!delivered) {
        removePending(messageId);
        reject(new Error(`invokeExtensionTool: extension '${extensionId}' worker is not mounted`));
      }
    } catch (error) {
      removePending(messageId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
