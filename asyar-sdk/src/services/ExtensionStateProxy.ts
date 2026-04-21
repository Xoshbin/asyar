import { BaseServiceProxy } from './BaseServiceProxy';

/**
 * SDK proxy for the launcher-brokered extension state store.
 *
 * Worker-side: `get`, `set`, `subscribe`, `unsubscribe`.
 * View-side:   `get`, `subscribe`, `unsubscribe` (no `set` — writes are
 *              worker-owned by convention, enforced at the role-scoped
 *              entry-point projection in `asyar-sdk/view` which omits `set`
 *              from the exposed surface).
 *
 * Per-extension scoping is enforced by the launcher's `ExtensionIpcRouter`,
 * which auto-injects the calling extension's id from the iframe's verified
 * origin (see `INJECTS_EXTENSION_ID`). The SDK proxy never passes an
 * extensionId; the host rejects any attempt to cross extension boundaries
 * without this proxy needing to know the id.
 */

type StateHandler = (value: unknown) => void;

interface ActiveSubscription {
  id: number;
  key: string;
  handler: StateHandler;
}

type WireRole = 'worker' | 'view';

export class ExtensionStateProxy extends BaseServiceProxy {
  private pushListenerInstalled = false;
  private readonly subs = new Map<number, ActiveSubscription>();
  private pagehideInstalled = false;

  async get(key: string): Promise<unknown> {
    return this.broker.invoke<unknown>('state:get', { key });
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.broker.invoke<void>('state:set', { key, value });
  }

  /**
   * Register a subscriber for `(this-extension, key)` in the current role.
   * Returns a disposer that issues `state:unsubscribe` when called. The
   * disposer is idempotent — calling it twice is harmless.
   */
  async subscribe(key: string, handler: StateHandler): Promise<() => Promise<void>> {
    this.ensurePushListener();
    const role = this.resolveRole();
    const id = await this.broker.invoke<number>('state:subscribe', { key, role });
    this.subs.set(id, { id, key, handler });

    let disposed = false;
    return async () => {
      if (disposed) return;
      disposed = true;
      this.subs.delete(id);
      try {
        await this.broker.invoke<void>('state:unsubscribe', { subscriptionId: id });
      } catch {
        // Idempotent: uninstall race may have cleared the subscription
        // server-side before the disposer ran. Don't surface.
      }
    };
  }

  /**
   * Install a one-shot `pagehide` listener on `window` that fires
   * `state:unsubscribe` for every active subscription. Called by the
   * view-side entry-point factory; worker-side projections skip this
   * because the worker iframe only unmounts on disable/uninstall and the
   * launcher's uninstall path calls `state:clear` which drops every
   * subscription server-side anyway.
   */
  installViewAutoUnsubscribe(): void {
    if (this.pagehideInstalled) return;
    this.pagehideInstalled = true;
    if (typeof window === 'undefined') return;
    window.addEventListener('pagehide', () => {
      const snapshot = Array.from(this.subs.values());
      this.subs.clear();
      for (const s of snapshot) {
        // Fire-and-forget — we're unmounting, nothing to await.
        this.broker
          .invoke<void>('state:unsubscribe', { subscriptionId: s.id })
          .catch(() => {});
      }
    });
  }

  private ensurePushListener(): void {
    if (this.pushListenerInstalled) return;
    this.pushListenerInstalled = true;
    this.broker.on('asyar:event:state:changed:push', (payload: unknown) => {
      if (!payload || typeof payload !== 'object') return;
      const p = payload as { key?: unknown; value?: unknown };
      if (typeof p.key !== 'string') return;
      for (const s of this.subs.values()) {
        if (s.key !== p.key) continue;
        try {
          s.handler(p.value);
        } catch {
          // One bad handler must not prevent the rest from firing.
        }
      }
    });
  }

  private resolveRole(): WireRole {
    if (typeof window !== 'undefined') {
      const injected = (window as { __ASYAR_ROLE__?: unknown }).__ASYAR_ROLE__;
      if (injected === 'worker' || injected === 'view') return injected;
    }
    // Neutral default. Entry-point role assertion runs at module-load, so
    // reaching this branch implies a test harness that didn't stub the
    // global — 'view' is the safer fallback (never fans out to workers).
    return 'view';
  }
}

export const extensionStateProxy = new ExtensionStateProxy();
