import { type UnlistenFn } from '@tauri-apps/api/event';
import { postToExtension } from '../extension/extensionDelivery';
import { bridgeListen } from '../../lib/ipc/bridgeEvents';

/** State subscriptions are strictly role-scoped; never forward to the other role. */
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
    this.unlisten = await bridgeListen<StateChangedEnvelope>('asyar:state-changed', (msg) => {
      const { extensionId, key, value, role } = msg.payload;
      postToExtension(
        extensionId,
        role,
        {
          type: 'asyar:event:state:changed:push',
          payload: { extensionId, key, value, role },
        },
        { fallback: false },
      );
    });
  }

  dispose(): void {
    this.unlisten?.();
    this.unlisten = null;
  }
}

export const stateChangedBridge = new StateChangedBridge();
