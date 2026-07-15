/** Browser-only Tier 2 tool bridge. Tool routing and execution policy live in Rust. */
import { pickExtensionIframe } from '../../services/extension/extensionIframeSelector';
import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';

let messageIdCounter = 0;

interface PendingResponse {
  source: Window;
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

function ensureResponseListener(): void {
  if (responseListenerInstalled) return;
  responseListenerInstalled = true;
  window.addEventListener('message', (event: MessageEvent) => {
    const message = event.data as Record<string, unknown> | null;
    if (!message || typeof message !== 'object') return;
    if (message.type !== 'asyar:tools:invoke:response') return;
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
  });
}

export async function invokeExtensionTool(
  extensionId: string,
  toolId: string,
  args: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const targetWindow = pickExtensionIframe(extensionId, 'worker')?.contentWindow;
  if (!targetWindow) {
    throw new Error(`invokeExtensionTool: extension '${extensionId}' worker iframe is not mounted`);
  }
  if (signal?.aborted) throw new Error('Extension tool dispatch was cancelled');

  const messageId = `tool-${++messageIdCounter}-${Date.now()}`;
  const expectedOrigin = getExtensionFrameOrigin(extensionId);
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
    targetWindow.postMessage(
      {
        type: 'asyar:tools:invoke',
        messageId,
        payload: { id: toolId, args },
      },
      expectedOrigin,
    );
  });
}
