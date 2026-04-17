import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { logService } from '../log/logService';
import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';

interface SystemEventEnvelope {
  extensionId: string;
  event: Record<string, unknown>;
}

/**
 * Bridges Rust-emitted `asyar:system-event` Tauri events to extension
 * iframes. Rust emits one event per unique subscribed extension (per
 * platform-event dispatch); this bridge looks up the iframe by
 * `data-extension-id` and posts `asyar:event:system-event:push` — the
 * wire type the SDK's `SystemEventsServiceProxy` listens for via
 * `MessageBroker.on(...)`.
 *
 * If the target iframe is torn down (extension uninstalled/disabled
 * mid-flight), the event is dropped silently. Rust-side cleanup in
 * `lifecycle.rs` removes the subscription on uninstall, so this case is
 * racy but bounded.
 */
class SystemEventsBridge {
  private unlisten: UnlistenFn | null = null;

  async init(): Promise<void> {
    if (this.unlisten) return;
    this.unlisten = await listen<SystemEventEnvelope>('asyar:system-event', (msg) => {
      const { extensionId, event } = msg.payload;
      const iframe = document.querySelector(
        `iframe[data-extension-id="${extensionId}"]`,
      ) as HTMLIFrameElement | null;
      if (!iframe?.contentWindow) {
        logService.debug(
          `[systemEventsBridge] no iframe for ${extensionId}; event dropped`,
        );
        return;
      }
      iframe.contentWindow.postMessage(
        { type: 'asyar:event:system-event:push', payload: event },
        getExtensionFrameOrigin(extensionId),
      );
    });
  }

  dispose(): void {
    this.unlisten?.();
    this.unlisten = null;
  }
}

export const systemEventsBridge = new SystemEventsBridge();
