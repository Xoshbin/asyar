/**
 * toolDispatch — routes `invokeTool` calls to the right backend.
 *
 * - `builtin:<id>` → `agents_invoke_builtin_tool` Tauri command.
 * - `<extId>:<id>` → post `asyar:tools:invoke` to the extension's worker
 *   iframe, await the `asyar:tools:invoke:response` envelope.
 */

import { invoke } from '@tauri-apps/api/core';
import { pickExtensionIframe } from '../../services/extension/extensionIframeSelector';
import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';

let messageIdCounter = 0;
const pendingResponses = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

let responseListenerInstalled = false;

function ensureResponseListener(): void {
  if (responseListenerInstalled) return;
  responseListenerInstalled = true;
  window.addEventListener('message', (event: MessageEvent) => {
    const msg = event.data as Record<string, unknown> | null;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type !== 'asyar:tools:invoke:response') return;
    const messageId = msg.messageId as string | undefined;
    if (!messageId) return;
    const pending = pendingResponses.get(messageId);
    if (!pending) return;
    pendingResponses.delete(messageId);
    if ('error' in msg) {
      pending.reject(new Error(String(msg.error)));
    } else {
      pending.resolve(msg.result);
    }
  });
}

export async function invokeTool(
  fullyQualifiedId: string,
  args: unknown,
): Promise<unknown> {
  const colonIdx = fullyQualifiedId.indexOf(':');
  if (colonIdx === -1) {
    throw new Error(
      `invokeTool: invalid tool id — expected 'source:id' format, got '${fullyQualifiedId}'`,
    );
  }

  const source = fullyQualifiedId.slice(0, colonIdx);
  const id = fullyQualifiedId.slice(colonIdx + 1);

  if (source === 'builtin') {
    return invoke('agents_invoke_builtin_tool', { id, args });
  }

  // Tier 2: source is the extension id.
  const iframe = pickExtensionIframe(source, 'worker');
  if (!iframe) {
    throw new Error(
      `invokeTool: extension '${source}' worker iframe is not mounted`,
    );
  }

  const messageId = `tool-${++messageIdCounter}-${Date.now()}`;
  ensureResponseListener();

  return new Promise<unknown>((resolve, reject) => {
    pendingResponses.set(messageId, { resolve, reject });
    iframe.contentWindow?.postMessage(
      {
        type: 'asyar:tools:invoke',
        messageId,
        payload: { id, args },
      },
      getExtensionFrameOrigin(source),
    );
  });
}
