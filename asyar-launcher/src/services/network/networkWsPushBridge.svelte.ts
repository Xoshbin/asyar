import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { logService } from '../log/logService';
import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';
import { pickExtensionIframe } from '../extension/extensionIframeSelector';

export interface WsMessageEventPayload {
  socket_id: string;
  extension_id: string;
  origin_role: 'view' | 'worker';
  event_type: 'open' | 'message' | 'error' | 'close';
  data?: string;
  code?: number;
}

export interface NetworkWsPushBridge {
  init(): Promise<void>;
  dispose(): void;
}

let unlisten: UnlistenFn | null = null;

export const networkWsPushBridge: NetworkWsPushBridge = {
  async init(): Promise<void> {
    if (unlisten) return;
    unlisten = await listen<WsMessageEventPayload>('asyar:event:network:wsMessage', (msg) => {
      const payload = msg.payload;
      const extensionId = payload.extension_id;

      const iframe = pickExtensionIframe(extensionId, payload.origin_role, { fallback: false });
      if (!iframe?.contentWindow) {
        logService.debug(
          `[NetworkWsPushBridge] no ${payload.origin_role} iframe for ${extensionId}; socket event dropped`,
        );
        return;
      }

      const targetOrigin = getExtensionFrameOrigin(extensionId);
      iframe.contentWindow.postMessage(
        { type: 'asyar:event:network:wsMessage:push', payload },
        targetOrigin,
      );
    });
  },

  dispose(): void {
    unlisten?.();
    unlisten = null;
  },
};
