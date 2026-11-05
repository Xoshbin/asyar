/**
 * Browser-only Tier 2 remote file search dispatch bridge.
 * Dispatches file search queries to extension worker contexts and awaits normalized search results.
 */
import { pickExtensionIframe } from './extensionIframeSelector';
import { postToExtension } from './extensionDelivery';
import { workerHost } from './workerHost.svelte';
import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';
import { TIER2_FILE_SEARCH_RESPONSE_TYPE } from '../../lib/ipc/extensionMessageProtocol';

export const FILE_SEARCH_TIMEOUT_MS = 4000;
export const MAX_FILE_SEARCH_RESULTS = 20;

export interface FileSearchResultItem {
  id: string;
  title: string;
  container?: string;
  url?: string;
  path?: string;
  icon?: string;
  mimeType?: string;
  modifiedAt?: number;
  size?: number;
}

export interface FileSearchQueryArgs {
  query: string;
  limit?: number;
}

export type ManifestResolver = (
  extensionId: string,
) => { permissions?: string[] } | undefined | null;

let manifestResolver: ManifestResolver | null = null;

export function registerFileSearchManifestResolver(resolver: ManifestResolver | null): void {
  manifestResolver = resolver;
}

export function isPathAllowedForExtension(extensionId: string, path: string): boolean {
  if (!path || typeof path !== 'string') return false;
  const trimmed = path.trim();
  // Must be an absolute path without directory traversal
  if (!trimmed.startsWith('/') && !/^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return false;
  }
  if (trimmed.includes('..')) {
    return false;
  }
  const manifest = manifestResolver?.(extensionId);
  const permissions = manifest?.permissions ?? [];
  return permissions.includes('shell:open-path') || permissions.includes('fs:read');
}

let messageIdCounter = 0;

interface PendingResponse {
  extensionId: string;
  source: MessageEventSource | object;
  expectedOrigin: string;
  limit: number;
  resolve: (value: FileSearchResultItem[]) => void;
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

function cleanHttpUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  return undefined;
}

function normalizeFileSearchResults(
  raw: unknown,
  limit: number,
  extensionId: string,
): FileSearchResultItem[] {
  if (!Array.isArray(raw)) {
    throw new Error('Extension file search returned invalid response (expected array)');
  }
  const maxLimit = Math.min(Math.max(1, limit), MAX_FILE_SEARCH_RESULTS);
  const items: FileSearchResultItem[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const id = typeof obj.id === 'string' ? obj.id : String(obj.id ?? '');
    const title = typeof obj.title === 'string' ? obj.title.trim().slice(0, 256) : '';
    if (!id || !title) continue;

    const container =
      typeof obj.container === 'string' ? obj.container.trim().slice(0, 256) : undefined;
    const url = cleanHttpUrl(obj.url);
    const rawPath = typeof obj.path === 'string' ? obj.path.trim() : undefined;
    const path = rawPath && isPathAllowedForExtension(extensionId, rawPath) ? rawPath : undefined;
    const icon = typeof obj.icon === 'string' ? obj.icon.trim() : undefined;
    const mimeType = typeof obj.mimeType === 'string' ? obj.mimeType.trim() : undefined;
    const modifiedAt = typeof obj.modifiedAt === 'number' ? obj.modifiedAt : undefined;
    const size = typeof obj.size === 'number' ? obj.size : undefined;

    items.push({
      id,
      title,
      container,
      url,
      path,
      icon,
      mimeType,
      modifiedAt,
      size,
    });

    if (items.length >= maxLimit) break;
  }

  return items;
}

/** Consumes both window messages and authenticated worker pipeline messages. */
export function handleFileSearchResponse(event: MessageEvent): void {
  const message = event.data as Record<string, unknown> | null;
  if (!message || typeof message !== 'object') return;
  if (message.type !== TIER2_FILE_SEARCH_RESPONSE_TYPE) return;
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
      const normalized = normalizeFileSearchResults(
        message.result,
        pending.limit,
        pending.extensionId,
      );
      pending.resolve(normalized);
    } catch (err) {
      pending.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

function ensureResponseListener(): void {
  if (responseListenerInstalled) return;
  responseListenerInstalled = true;
  window.addEventListener('message', handleFileSearchResponse);
}

export async function invokeExtensionFileSearch(
  extensionId: string,
  providerId: string,
  args: FileSearchQueryArgs,
  signal?: AbortSignal,
): Promise<FileSearchResultItem[]> {
  const worker = workerHost.getWorker(extensionId);
  const targetWindow = worker
    ? (worker.rawWorker ?? worker)
    : pickExtensionIframe(extensionId, 'worker')?.contentWindow;
  if (!targetWindow) {
    throw new Error(`invokeExtensionFileSearch: extension '${extensionId}' worker is not mounted`);
  }
  if (signal?.aborted) throw new Error('Extension file search dispatch was cancelled');

  const messageId = `filesearch-${++messageIdCounter}-${Date.now()}`;
  const expectedOrigin = worker
    ? `asyar-extension://${extensionId}`
    : getExtensionFrameOrigin(extensionId);
  ensureResponseListener();

  const limit = typeof args.limit === 'number' ? args.limit : 10;
  const queryPayload = {
    providerId,
    query: args.query,
    limit,
  };

  return new Promise<FileSearchResultItem[]>((resolve, reject) => {
    const notifyWorkerAbort = () => {
      try {
        postToExtension(extensionId, 'worker', {
          type: 'asyar:fileSearch:abort',
          messageId,
        });
      } catch {
        // best effort abort notification
      }
    };

    const onAbort = signal
      ? () => {
          if (!removePending(messageId)) return;
          notifyWorkerAbort();
          reject(new Error('Extension file search dispatch was cancelled'));
        }
      : undefined;

    const timer = setTimeout(() => {
      if (!removePending(messageId)) return;
      notifyWorkerAbort();
      reject(
        new Error(
          `invokeExtensionFileSearch: request '${messageId}' timed out after ${FILE_SEARCH_TIMEOUT_MS}ms`,
        ),
      );
    }, FILE_SEARCH_TIMEOUT_MS);

    pendingResponses.set(messageId, {
      extensionId,
      source: targetWindow,
      expectedOrigin,
      limit,
      resolve,
      reject,
      signal,
      onAbort,
      timer,
    });
    signal?.addEventListener('abort', onAbort!, { once: true });

    try {
      const delivered = postToExtension(extensionId, 'worker', {
        type: 'asyar:fileSearch:query',
        messageId,
        payload: queryPayload,
      });
      if (!delivered) {
        removePending(messageId);
        reject(
          new Error(`invokeExtensionFileSearch: extension '${extensionId}' worker is not mounted`),
        );
      }
    } catch (error) {
      removePending(messageId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
