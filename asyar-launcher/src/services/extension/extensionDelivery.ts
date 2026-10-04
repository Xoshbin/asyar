import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';
import type { IpcPendingMessage } from '../../lib/ipc/iframeLifecycleCommands';
import { toWireMessage } from './extensionWireMessage';
import { workerHost } from './workerHost.svelte';
import { pickExtensionIframe } from './extensionIframeSelector';
import { logService } from '../log/logService';

export { toWireMessage } from './extensionWireMessage';

/** Delivers to a mounted worker first, then its compatibility iframe. */
export function postToExtension(
  extensionId: string,
  role: 'worker' | 'view',
  message: unknown,
  options: { fallback?: boolean; logTag?: string } = {},
): boolean {
  if (role === 'worker' && workerHost.hasWorker(extensionId)) {
    workerHost.post(extensionId, message);
    return true;
  }
  const iframe = pickExtensionIframe(
    extensionId,
    role,
    options.fallback === undefined ? {} : { fallback: options.fallback },
  );
  if (iframe?.contentWindow) {
    iframe.contentWindow.postMessage(message, getExtensionFrameOrigin(extensionId));
    return true;
  }
  logService.warn(
    `[${options.logTag ?? 'extensionDelivery'}] no target for ${extensionId} role=${role}; message dropped`,
  );
  return false;
}

export function post(iframe: HTMLIFrameElement, message: IpcPendingMessage): void {
  const wire = toWireMessage(message);
  if (!wire) return;
  const extensionId = iframe.getAttribute('data-extension-id');
  if (!extensionId || !iframe.contentWindow) return;
  iframe.contentWindow.postMessage(wire, getExtensionFrameOrigin(extensionId));
}
