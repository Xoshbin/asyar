import {
  iframeReadyAck,
  type IpcPendingMessage,
} from '../../lib/ipc/iframeLifecycleCommands';
import { post } from './extensionDelivery';
import { logService } from '../log/logService';
import { extensionPendingState } from './extensionPendingState.svelte';

class ExtensionReadinessListener {
  private handler: ((e: MessageEvent) => void) | null = null;

  init(): void {
    if (this.handler) return;
    this.handler = (event: MessageEvent) => {
      this.handle(event).catch((err) =>
        logService.warn(`[readiness] handler threw: ${err}`),
      );
    };
    window.addEventListener('message', this.handler);
  }

  reset(): void {
    if (this.handler) {
      window.removeEventListener('message', this.handler);
      this.handler = null;
    }
  }

  private async handle(event: MessageEvent): Promise<void> {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type !== 'asyar:extension:loaded') return;

    const iframes = Array.from(
      document.querySelectorAll<HTMLIFrameElement>('iframe[data-extension-id]'),
    );
    const iframe = iframes.find((el) => el.contentWindow === event.source);
    if (!iframe) return;

    const extensionId = iframe.getAttribute('data-extension-id');
    const mountTokenStr = iframe.getAttribute('data-mount-token');
    if (!extensionId || !mountTokenStr) return;
    const mountToken = Number(mountTokenStr);
    if (!Number.isFinite(mountToken)) return;

    // Role is authoritative from the SDK-emitted payload. The iframe's
    // data-role DOM attribute is retained for the dev inspector but is not
    // read here — the listener trusts the sender's self-declared role via
    // postMessage.
    const payloadRole = (data as { role?: unknown }).role;
    if (payloadRole !== 'view' && payloadRole !== 'worker') {
      logService.error(
        `[readiness] asyar:extension:loaded from ${extensionId} has no valid role in payload (got: ${String(payloadRole)})`,
      );
      return;
    }
    const role: 'view' | 'worker' = payloadRole;

    let drained: IpcPendingMessage[];
    try {
      drained = await iframeReadyAck(extensionId, mountToken, role);
    } catch (err) {
      logService.warn(`[readiness] ack failed for ${extensionId}: ${err}`);
      return;
    }
    for (const m of drained) post(iframe, m);
    extensionPendingState.markReady(extensionId);
  }
}

export const extensionReadinessListener = new ExtensionReadinessListener();
