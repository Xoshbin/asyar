/**
 * Browser-only Tier 2 web reader dispatch bridge.
 * Dispatches URL scraping/reading queries to extension worker contexts and awaits normalized reader results.
 */
import { pickExtensionIframe } from './extensionIframeSelector';
import { postToExtension } from './extensionDelivery';
import { workerHost } from './workerHost.svelte';
import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';
import { TIER2_WEB_READER_RESPONSE_TYPE } from '../../lib/ipc/extensionMessageProtocol';

export const WEB_READER_MAX_CHARS = 100_000;
export const WEB_READER_TIMEOUT_MS = 20_000;

export interface ExtensionWebReaderArgs {
  url: string;
  baseUrl?: string;
  [key: string]: unknown;
}

export interface ExtensionWebReaderResult {
  url: string;
  title?: string;
  content: string;
  status?: number;
  metadata?: Record<string, unknown>;
}

let messageIdCounter = 0;

interface PendingResponse {
  source: MessageEventSource | object;
  expectedOrigin: string;
  resolve: (value: ExtensionWebReaderResult) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
  timer?: ReturnType<typeof setTimeout>;
}

const pendingResponses = new Map<string, PendingResponse>();
let responseListenerInstalled = false;

function removePending(messageId: string): PendingResponse | undefined {
  const pending = pendingResponses.get(messageId);
  if (!pending) return undefined;
  pendingResponses.delete(messageId);
  if (pending.timer) clearTimeout(pending.timer);
  if (pending.signal && pending.onAbort) {
    pending.signal.removeEventListener('abort', pending.onAbort);
  }
  return pending;
}

function normalizeWebReaderResult(raw: unknown): ExtensionWebReaderResult {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Extension web reader returned invalid response (expected object)');
  }
  const obj = raw as Record<string, unknown>;
  const url = typeof obj.url === 'string' ? obj.url : '';
  const title = typeof obj.title === 'string' ? obj.title : undefined;
  let content = typeof obj.content === 'string' ? obj.content : '';
  if (content.length > WEB_READER_MAX_CHARS) {
    content = `${content.slice(0, WEB_READER_MAX_CHARS)}\n\n[Content truncated by Asyar Web Reader limit]`;
  }
  const status = typeof obj.status === 'number' ? obj.status : undefined;
  const metadata =
    obj.metadata && typeof obj.metadata === 'object'
      ? (obj.metadata as Record<string, unknown>)
      : undefined;

  return { url, title, content, status, metadata };
}

/** Consumes both window messages and authenticated worker pipeline messages. */
export function handleWebReaderResponse(event: MessageEvent): void {
  const message = event.data as Record<string, unknown> | null;
  if (!message || typeof message !== 'object') return;
  if (message.type !== TIER2_WEB_READER_RESPONSE_TYPE) return;
  const messageId = typeof message.messageId === 'string' ? message.messageId : null;
  if (!messageId) return;

  const pending = pendingResponses.get(messageId);
  if (!pending || event.source !== pending.source) return;
  if (pending.expectedOrigin !== '*' && event.origin !== pending.expectedOrigin) return;

  removePending(messageId);
  if ('error' in message) {
    pending.reject(new Error(String(message.error)));
  } else {
    try {
      const normalized = normalizeWebReaderResult(message.result);
      pending.resolve(normalized);
    } catch (err) {
      pending.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

function ensureResponseListener(): void {
  if (responseListenerInstalled) return;
  responseListenerInstalled = true;
  window.addEventListener('message', handleWebReaderResponse);
}

export async function invokeExtensionWebReader(
  extensionId: string,
  readerId: string,
  args: ExtensionWebReaderArgs,
  signal?: AbortSignal,
): Promise<ExtensionWebReaderResult> {
  const worker = workerHost.getWorker(extensionId);
  const targetWindow = worker
    ? (worker.rawWorker ?? worker)
    : pickExtensionIframe(extensionId, 'worker')?.contentWindow;
  if (!targetWindow) {
    throw new Error(`invokeExtensionWebReader: extension '${extensionId}' worker is not mounted`);
  }
  if (signal?.aborted) throw new Error('Extension web reader dispatch was cancelled');

  const messageId = `webreader-${++messageIdCounter}-${Date.now()}`;
  const expectedOrigin = worker
    ? `asyar-extension://${extensionId}`
    : getExtensionFrameOrigin(extensionId);
  ensureResponseListener();

  const queryPayload = {
    readerId,
    ...args,
  };

  return new Promise<ExtensionWebReaderResult>((resolve, reject) => {
    const onAbort = signal
      ? () => {
          if (!removePending(messageId)) return;
          reject(new Error('Extension web reader dispatch was cancelled'));
        }
      : undefined;

    const timer = setTimeout(() => {
      if (!removePending(messageId)) return;
      reject(
        new Error(`Extension web reader dispatch timed out after ${WEB_READER_TIMEOUT_MS / 1000}s`),
      );
    }, WEB_READER_TIMEOUT_MS);

    pendingResponses.set(messageId, {
      source: targetWindow,
      expectedOrigin,
      resolve,
      reject,
      signal,
      onAbort,
      timer,
    });
    signal?.addEventListener('abort', onAbort!, { once: true });

    try {
      const delivered = postToExtension(extensionId, 'worker', {
        type: 'asyar:webReader:query',
        messageId,
        payload: queryPayload,
      });
      if (!delivered) {
        removePending(messageId);
        reject(
          new Error(`invokeExtensionWebReader: extension '${extensionId}' worker is not mounted`),
        );
      }
    } catch (error) {
      removePending(messageId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
