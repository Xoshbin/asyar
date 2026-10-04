import { type UnlistenFn } from '@tauri-apps/api/event';
import { postToExtension } from '../extension/extensionDelivery';
import { bridgeListen } from '../../lib/ipc/bridgeEvents';

interface EventEnvelope {
  extensionId: string;
  event: Record<string, unknown>;
}

export interface PushBridge {
  init(): Promise<void>;
  dispose(): void;
}

/** Forwards Rust subscription events to the worker, falling back to a view-only extension. */
export function createPushBridge(
  tauriEventName: string,
  iframeMessageType: string,
  logTag: string,
): PushBridge {
  let unlisten: UnlistenFn | null = null;

  return {
    async init(): Promise<void> {
      if (unlisten) return;
      unlisten = await bridgeListen<EventEnvelope>(tauriEventName, (msg) => {
        const { extensionId, event } = msg.payload;
        postToExtension(
          extensionId,
          'worker',
          { type: iframeMessageType, payload: event },
          { logTag },
        );
      });
    },

    dispose(): void {
      unlisten?.();
      unlisten = null;
    },
  };
}
