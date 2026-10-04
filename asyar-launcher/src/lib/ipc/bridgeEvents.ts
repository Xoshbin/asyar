import { invoke } from '@tauri-apps/api/core';
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

export interface BridgeEvent {
  event: string;
  payload: unknown;
}

const PENDING_CAP = 256;

const handlers = new Map<string, Set<(e: { payload: any }) => void>>();
const pending = new Map<string, unknown[]>();
let started = false;

function bufferPayload(event: string, payload: unknown): void {
  const queue = pending.get(event);
  if (!queue) {
    pending.set(event, [payload]);
    return;
  }
  queue.push(payload);
  if (queue.length > PENDING_CAP) queue.shift();
}

/**
 * Dispatches an event directly into the local bridge handler set.
 * If no handlers are registered, buffers the payload for future listeners.
 */
export function dispatchBridgeEvent(event: string, payload: unknown): void {
  const set = handlers.get(event);
  if (set && set.size > 0) {
    for (const handler of set) {
      try {
        handler({ payload });
      } catch {
        // A throwing handler must not kill the dispatch loop or skip other handlers.
      }
    }
  } else {
    bufferPayload(event, payload);
  }
}

/**
 * Low-level bridge queue listener without native Tauri subscription.
 */
async function bridgeListenInternal<T>(
  event: string,
  cb: (e: { payload: T }) => void,
): Promise<() => void> {
  let set = handlers.get(event);
  if (!set) {
    set = new Set();
    handlers.set(event, set);
  }
  set.add(cb as (e: { payload: any }) => void);

  const queue = pending.get(event);
  if (queue && queue.length > 0) {
    pending.delete(event);
    for (const payload of queue) {
      try {
        cb({ payload: payload as T });
      } catch {
        // A flushing handler throwing must not block subsequent flushes.
      }
    }
  }

  return () => {
    const current = handlers.get(event);
    if (!current) return;
    current.delete(cb as (e: { payload: any }) => void);
    if (current.size === 0) handlers.delete(event);
  };
}

/**
 * Tauri delivers every `emit_to(<any label>)` to a listener registered with
 * the default `Any` target, so an unscoped listener also receives events the
 * host addressed to other windows. `bridge_emit` fans out to every non-poller
 * window with `emit_to`, which made the poller window see each event once per
 * other open window on top of its queued copy. Scoping the native listener to
 * this webview's own label keeps it to broadcast `emit` and events addressed
 * to it.
 */
function ownWebviewTarget(): { target: { kind: 'WebviewWindow'; label: string } } | undefined {
  try {
    return { target: { kind: 'WebviewWindow', label: getCurrentWebviewWindow().label } };
  } catch {
    return undefined;
  }
}

/**
 * Unified application event listener.
 *
 * Subscribes to the eval-free long-poll bridge queue and concurrently attaches
 * to Tauri's native `listen` for pre-connection boot events or OS-level window events,
 * ensuring no event is dropped regardless of backend emitter choice.
 */
export async function appListen<T>(
  event: string,
  cb: (e: { payload: T }) => void,
): Promise<() => void> {
  // Both subscriptions are issued in the same tick, before either is awaited,
  // so the native listener is registered as early as the bridge handler is.
  const bridgePromise = bridgeListenInternal<T>(event, cb);

  let unlistenTauri: UnlistenFn | null = null;
  try {
    unlistenTauri = await tauriListen<T>(
      event,
      (e) => {
        try {
          cb({ payload: e.payload });
        } catch {
          // A throwing handler must not crash the native listener loop.
        }
      },
      ownWebviewTarget(),
    );
  } catch {
    // Tauri event system unavailable or mocked out (e.g. non-Tauri test environments).
  }
  const unlistenBridge = await bridgePromise;

  return () => {
    unlistenBridge();
    if (unlistenTauri) {
      unlistenTauri();
    }
  };
}

/**
 * Backward-compatible alias for `appListen`.
 */
export const bridgeListen = appListen;

export function startBridgeLoop(): void {
  if (started) return;
  started = true;

  void (async () => {
    while (started) {
      let events: BridgeEvent[];
      try {
        events = await invoke<BridgeEvent[]>('bridge_poll');
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      if (!Array.isArray(events)) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      for (const { event, payload } of events) {
        dispatchBridgeEvent(event, payload);
      }
    }
  })();
}

export function stopBridgeLoop(): void {
  started = false;
}

/**
 * Test helper to reset internal maps and flags between tests.
 */
export function resetBridgeForTest(): void {
  stopBridgeLoop();
  handlers.clear();
  pending.clear();
}
