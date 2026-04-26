import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { logService } from '../log/logService';
import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';

/**
 * Bridges Rust-relayed worker → view RPC replies to the calling view
 * iframe. The Rust `state_rpc_reply` command emits `asyar:state-rpc-reply`
 * with `{extensionId, correlationId, result, error}`; the view-side SDK
 * matches the correlationId against its pending-reply table and
 * resolves/rejects accordingly.
 *
 * Only the view iframe receives replies — RPC direction is view→worker→view,
 * never worker→worker. Stale replies (view moved on / pagehide fired)
 * arrive to a view that no longer has the correlationId pending; the SDK
 * drops them silently.
 */
interface RpcReplyEnvelope {
  extensionId: string;
  correlationId: string;
  result?: unknown;
  error?: string;
}

export interface PushBridge {
  init(): Promise<void>;
  dispose(): void;
}

class RpcReplyBridge implements PushBridge {
  private unlisten: UnlistenFn | null = null;

  async init(): Promise<void> {
    if (this.unlisten) return;
    this.unlisten = await listen<RpcReplyEnvelope>('asyar:state-rpc-reply', (msg) => {
      const { extensionId, correlationId, result, error } = msg.payload;
      const iframe = document.querySelector(
        `iframe[data-extension-id="${extensionId}"][data-role="view"]`,
      ) as HTMLIFrameElement | null;
      if (!iframe?.contentWindow) {
        logService.debug(
          `[rpcReplyBridge] no view iframe for ${extensionId}; reply ${correlationId} dropped`,
        );
        return;
      }
      iframe.contentWindow.postMessage(
        {
          type: 'asyar:event:state:rpc-reply:push',
          payload: { correlationId, result, error },
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

export const rpcReplyBridge = new RpcReplyBridge();
