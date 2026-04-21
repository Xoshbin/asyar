import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { logService } from '../log/logService';
import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';

/**
 * Bridges Rust-emitted `asyar:state-changed` Tauri events to the matching
 * role-specific iframe for each subscribing extension. Unlike the other
 * push bridges (system-event / app-event / index-event), state:changed
 * events are **role-scoped** — Rust dedupes by `(extensionId, key, role)`
 * and emits at most one event per role per set, so each event payload
 * carries a `role` field and this bridge targets
 * `iframe[data-extension-id="..."][data-role="worker|view"]`.
 *
 * Drops silently if the target iframe is absent (worker might be in the
 * middle of remount; a subsequent set will re-fire once both sides are
 * ready again).
 */
interface StateChangedEnvelope {
  extensionId: string;
  key: string;
  value: unknown;
  role: 'worker' | 'view';
}

export interface PushBridge {
  init(): Promise<void>;
  dispose(): void;
}

class StateChangedBridge implements PushBridge {
  private unlisten: UnlistenFn | null = null;

  async init(): Promise<void> {
    if (this.unlisten) return;
    this.unlisten = await listen<StateChangedEnvelope>('asyar:state-changed', (msg) => {
      const { extensionId, key, value, role } = msg.payload;
      const iframe = document.querySelector(
        `iframe[data-extension-id="${extensionId}"][data-role="${role}"]`,
      ) as HTMLIFrameElement | null;
      if (!iframe?.contentWindow) {
        logService.debug(
          `[stateChangedBridge] no ${role} iframe for ${extensionId}; state:changed for ${key} dropped`,
        );
        return;
      }
      iframe.contentWindow.postMessage(
        {
          type: 'asyar:event:state:changed:push',
          payload: { extensionId, key, value, role },
        },
        getExtensionFrameOrigin(extensionId),
      );
    });
  }

  dispose(): void {
    this.unlisten?.();
    this.unlisten = null;
  }
}

export const stateChangedBridge = new StateChangedBridge();
