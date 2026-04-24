import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { logService } from '../log/logService';
import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';

interface EventEnvelope {
  extensionId: string;
  event: Record<string, unknown>;
}

export interface PushBridge {
  init(): Promise<void>;
  dispose(): void;
}

/**
 * Factory for a bridge that forwards Rust-emitted Tauri events to
 * extension iframes via postMessage.
 *
 * Rust emits one Tauri event per unique subscribed extension (dispatch is
 * deduped in `EventHub`). The bridge looks up the target iframe by
 * `data-extension-id` and posts the inner event payload with the supplied
 * `iframeMessageType`. If the iframe is gone (extension uninstalled /
 * disabled mid-flight), the event is dropped silently.
 *
 * Used by both `systemEventsBridge` (`asyar:system-event` →
 * `asyar:event:system-event:push`) and `appEventsBridge`
 * (`asyar:app-event` → `asyar:event:app-event:push`). The two bridges are
 * identical in shape; only the Tauri event name and the iframe message
 * type differ.
 */
export function createPushBridge(
  tauriEventName: string,
  iframeMessageType: string,
  logTag: string,
): PushBridge {
  let unlisten: UnlistenFn | null = null;

  return {
    async init(): Promise<void> {
      if (unlisten) return;
      unlisten = await listen<EventEnvelope>(tauriEventName, (msg) => {
        const { extensionId, event } = msg.payload;
        // Prefer the worker iframe. Push-event subscribers (systemEvents,
        // appEvents, etc.) are installed from the worker under the Phase 6
        // worker/view split so their callbacks survive view Dormant. Fall
        // back to the view iframe for legacy single-iframe extensions
        // (no background.main in the manifest, no worker iframe).
        // Unqualified `iframe[data-extension-id]` would hit whichever
        // iframe comes first in DOM order — typically the view — and the
        // push would silently vanish because the view has no callback
        // registered.
        const iframe =
          (document.querySelector(
            `iframe[data-extension-id="${extensionId}"][data-role="worker"]`,
          ) as HTMLIFrameElement | null) ??
          (document.querySelector(
            `iframe[data-extension-id="${extensionId}"][data-role="view"]`,
          ) as HTMLIFrameElement | null) ??
          (document.querySelector(
            `iframe[data-extension-id="${extensionId}"]`,
          ) as HTMLIFrameElement | null);
        if (!iframe?.contentWindow) {
          logService.debug(
            `[${logTag}] no iframe for ${extensionId}; event dropped`,
          );
          return;
        }
        iframe.contentWindow.postMessage(
          { type: iframeMessageType, payload: event },
          getExtensionFrameOrigin(extensionId),
        );
      });
    },

    dispose(): void {
      unlisten?.();
      unlisten = null;
    },
  };
}
