import { invoke } from '@tauri-apps/api/core';

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

export async function bridgeListen<T>(
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

export function startBridgeLoop(): void {
  if (started) return;
  started = true;

  void (async () => {
    while (true) {
      let events: BridgeEvent[];
      try {
        events = await invoke<BridgeEvent[]>('bridge_poll');
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      for (const { event, payload } of events) {
        const set = handlers.get(event);
        if (set && set.size > 0) {
          for (const handler of set) {
            try {
              handler({ payload });
            } catch {
              // A throwing handler must not kill the loop or skip other handlers.
            }
          }
        } else {
          bufferPayload(event, payload);
        }
      }
    }
  })();
}
