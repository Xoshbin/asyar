import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { logService } from '../log/logService';
import { postToExtension } from '../extension/extensionDelivery';

interface TrayClickEnvelope {
  extensionId: string;
  event: { itemPath?: string[]; checked?: boolean };
}

/**
 * Forwards Rust-emitted `asyar:tray-item-click` events to the owning
 * extension worker so the SDK's `StatusBarServiceProxy` can fire the
 * user-registered `onClick` handler.
 *
 * This is a bespoke version of the shared `createPushBridge` pattern — it
 * logs every stage of the dispatch so a missing click path (Rust emitted
 * but worker silent, or vice-versa) is obvious in the launcher logs.
 */
export const trayClickBridge = {
  _unlisten: null as UnlistenFn | null,

  async init(): Promise<void> {
    if (this._unlisten) return;
    this._unlisten = await listen<TrayClickEnvelope>('asyar:tray-item-click', (msg) => {
      const { extensionId, event } = msg.payload;
      logService.debug(
        `[trayClickBridge] received click for ext='${extensionId}' path=${JSON.stringify(event?.itemPath ?? [])}`,
      );
      postToExtension(extensionId, 'worker', {
        type: 'asyar:event:statusBar:click',
        payload: event,
      });
    });
    logService.debug('[trayClickBridge] listening for asyar:tray-item-click');
  },

  dispose(): void {
    this._unlisten?.();
    this._unlisten = null;
  },
};
