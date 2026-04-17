import { BaseServiceProxy } from './BaseServiceProxy';
import type {
  ISystemEventsService,
  SystemEvent,
  SystemEventKind,
  Disposer,
} from './ISystemEventsService';

interface PerKindState {
  subscriptionIdPromise: Promise<string>;
  callbacks: Set<(ev: SystemEvent) => void>;
}

/**
 * Proxy for the system-events push service.
 *
 * Ref-counts listeners per event kind — the first listener for a given kind
 * issues one `system-events:subscribe` RPC; subsequent listeners on the same
 * kind reuse the subscription. When the last listener for a kind is
 * disposed, one `system-events:unsubscribe` RPC fires.
 *
 * A single `asyar:event:system-event:push` message listener is installed
 * lazily on the first subscribe and dispatches the payload to the matching
 * callback set by `event.type`.
 */
export class SystemEventsServiceProxy
  extends BaseServiceProxy
  implements ISystemEventsService
{
  private states = new Map<SystemEventKind, PerKindState>();
  private pushListenerInstalled = false;

  private ensurePushListener(): void {
    if (this.pushListenerInstalled) return;
    this.pushListenerInstalled = true;
    this.broker.on('asyar:event:system-event:push', (payload: unknown) => {
      if (!payload || typeof payload !== 'object' || !('type' in payload)) return;
      const ev = payload as SystemEvent;
      const state = this.states.get(ev.type);
      if (!state) return;
      for (const cb of state.callbacks) {
        try {
          cb(ev);
        } catch {
          // One bad callback must not prevent the rest from firing.
        }
      }
    });
  }

  private listen<T extends SystemEvent>(
    kind: SystemEventKind,
    dispatch: (ev: T) => void,
  ): Disposer {
    this.ensurePushListener();
    let state = this.states.get(kind);
    if (!state) {
      const subscriptionIdPromise = this.broker.invoke<string>(
        'systemEvents:subscribe',
        { eventTypes: [kind] },
      );
      state = { subscriptionIdPromise, callbacks: new Set() };
      this.states.set(kind, state);
    }
    const wrapped = (ev: SystemEvent) => dispatch(ev as T);
    state.callbacks.add(wrapped);

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const s = this.states.get(kind);
      if (!s) return;
      s.callbacks.delete(wrapped);
      if (s.callbacks.size === 0) {
        this.states.delete(kind);
        s.subscriptionIdPromise
          .then((id) =>
            this.broker.invoke<void>('systemEvents:unsubscribe', {
              subscriptionId: id,
            }),
          )
          .catch(() => {
            // Subscribe failed; nothing to unsubscribe.
          });
      }
    };
  }

  onSystemSleep(cb: () => void): Disposer {
    return this.listen('sleep', () => cb());
  }

  onSystemWake(cb: () => void): Disposer {
    return this.listen('wake', () => cb());
  }

  onLidOpen(cb: () => void): Disposer {
    return this.listen('lid-open', () => cb());
  }

  onLidClose(cb: () => void): Disposer {
    return this.listen('lid-close', () => cb());
  }

  onBatteryLevelChange(cb: (percent: number) => void): Disposer {
    return this.listen<Extract<SystemEvent, { type: 'battery-level-changed' }>>(
      'battery-level-changed',
      (ev) => cb(ev.percent),
    );
  }

  onPowerSourceChange(cb: (onBattery: boolean) => void): Disposer {
    return this.listen<Extract<SystemEvent, { type: 'power-source-changed' }>>(
      'power-source-changed',
      (ev) => cb(ev.onBattery),
    );
  }
}
