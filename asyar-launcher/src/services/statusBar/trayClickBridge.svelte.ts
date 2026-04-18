import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { logService } from '../log/logService';
import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';

interface TrayClickEnvelope {
  extensionId: string;
  event: { itemPath?: string[]; checked?: boolean };
}

/**
 * Forwards Rust-emitted `asyar:tray-item-click` events to the owning
 * extension iframe so the SDK's `StatusBarServiceProxy` can fire the
 * user-registered `onClick` handler.
 *
 * This is a bespoke version of the shared `createPushBridge` pattern — it
 * logs every stage of the dispatch so a missing click path (Rust emitted
 * but iframe silent, or vice-versa) is obvious in the launcher logs.
 */
export const trayClickBridge = {
  _unlisten: null as UnlistenFn | null,

  async init(): Promise<void> {
    if (this._unlisten) return;
    this._unlisten = await listen<TrayClickEnvelope>(
      'asyar:tray-item-click',
      (msg) => {
        const { extensionId, event } = msg.payload;
        logService.debug(
          `[trayClickBridge] received click for ext='${extensionId}' path=${JSON.stringify(event?.itemPath ?? [])}`,
        );
        const iframe = document.querySelector(
          `iframe[data-extension-id="${extensionId}"]`,
        ) as HTMLIFrameElement | null;
        if (!iframe?.contentWindow) {
          logService.warn(
            `[trayClickBridge] no iframe found for ${extensionId}; click dropped`,
          );
          return;
        }
        iframe.contentWindow.postMessage(
          { type: 'asyar:event:statusBar:click', payload: event },
          getExtensionFrameOrigin(extensionId),
        );
      },
    );
    logService.debug('[trayClickBridge] listening for asyar:tray-item-click');
  },

  dispose(): void {
    this._unlisten?.();
    this._unlisten = null;
  },
};
