import { BaseServiceProxy } from './BaseServiceProxy';

/**
 * View → worker RPC primitive.
 *
 * The view issues `request(id, payload, { timeoutMs })` and awaits a reply
 * matched by correlation id. The launcher relays the request via the worker
 * mailbox (so it survives Dormant/Mounting) and the reply via a broadcast
 * `asyar:event:state:rpc-reply:push`.
 *
 * The worker registers `onRequest(id, handler)`; the SDK inspects every
 * incoming action payload for the `__rpc__` discriminator and routes:
 *   - `__rpc__: "request"` → invoke handler, forward result/error via
 *     `state:rpcReply`.
 *   - `__rpc__: "abort"`  → fire the in-flight handler's AbortSignal.
 *
 * Handlers that ignore the signal still produce a detectable leak: the
 * reply arrives after the view has settled (timeout/unmount), view-side
 * drops it silently at `debug` log level. Document this in handler JSDoc so
 * extension authors know the invariant.
 */

type AnyPayload = unknown;

type ViewRequestHandler = (payload: AnyPayload, signal: AbortSignal) => Promise<AnyPayload>;

interface PendingReply {
  resolve: (value: AnyPayload) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  // Kept so stale replies can be traced in logs.
  settled: boolean;
}

interface InFlightHandler {
  controller: AbortController;
}

const DEFAULT_TIMEOUT_MS = 5000;

export class ExtensionRpc extends BaseServiceProxy {
  // ── view-side state ─────────────────────────────────────────────────────
  private pending = new Map<string, PendingReply>();
  private viewListenerInstalled = false;
  private pagehideInstalled = false;

  // ── worker-side state ───────────────────────────────────────────────────
  private handlers = new Map<string, ViewRequestHandler>();
  private inFlight = new Map<string, InFlightHandler>();

  // ── view-side: request / abort ──────────────────────────────────────────

  /**
   * Send a request to this extension's worker. Resolves with the worker's
   * return value; rejects on worker-side throw, on host RPC error, or on
   * timeout (default 5000 ms, overridable via `opts.timeoutMs`).
   *
   * Generates a correlation id, enqueues via `state:rpcRequest`, stores a
   * pending-reply entry keyed by the id, starts a timer. Reply arrival
   * (via `asyar:event:state:rpc-reply:push`) resolves/rejects the entry
   * and cancels the timer. Timeout rejects, fires `state:rpcAbort` so the
   * worker handler's AbortSignal trips, and removes the entry so a stale
   * reply is silently dropped.
   */
  async request(
    id: string,
    payload: AnyPayload,
    opts?: { timeoutMs?: number },
  ): Promise<AnyPayload> {
    this.ensureViewListener();
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const correlationId = this.generateCorrelationId();

    return new Promise<AnyPayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        const entry = this.pending.get(correlationId);
        if (!entry || entry.settled) return;
        entry.settled = true;
        this.pending.delete(correlationId);
        // Best-effort abort notification to the worker.
        this.broker
          .invoke<void>('state:rpcAbort', { correlationId })
          .catch(() => {});
        reject(new Error(`RPC timeout after ${timeoutMs}ms for id=${id}`));
      }, timeoutMs);

      this.pending.set(correlationId, {
        resolve,
        reject,
        timer,
        settled: false,
      });

      // Fire-and-forget the enqueue; the reply comes back through the
      // push listener, not this invoke's resolution.
      this.broker
        .invoke<void>('state:rpcRequest', { id, correlationId, payload })
        .catch((err: unknown) => {
          const entry = this.pending.get(correlationId);
          if (!entry || entry.settled) return;
          entry.settled = true;
          clearTimeout(entry.timer);
          this.pending.delete(correlationId);
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });
  }

  /**
   * Install the view-side `asyar:event:state:rpc-reply:push` listener.
   * Idempotent. Callers: the view-entry factory.
   */
  installViewMessageListener(): void {
    this.ensureViewListener();
  }

  /**
   * Install a `pagehide` listener that drops every pending reply so the
   * next view mount sees no zombie state. Stale replies arriving post-
   * pagehide are dropped silently.
   */
  installViewAutoCleanup(): void {
    if (this.pagehideInstalled) return;
    this.pagehideInstalled = true;
    if (typeof window === 'undefined') return;
    window.addEventListener('pagehide', () => this.disposeAllPending());
  }

  /**
   * Clear every pending-reply entry. Exposed (not private) so tests can
   * trigger the same cleanup pagehide would run.
   */
  disposeAllPending(): void {
    for (const entry of this.pending.values()) {
      entry.settled = true;
      clearTimeout(entry.timer);
    }
    this.pending.clear();
  }

  private ensureViewListener(): void {
    if (this.viewListenerInstalled) return;
    this.viewListenerInstalled = true;
    this.broker.on('asyar:event:state:rpc-reply:push', (payload: unknown) => {
      if (!payload || typeof payload !== 'object') return;
      const p = payload as {
        correlationId?: unknown;
        result?: unknown;
        error?: unknown;
      };
      if (typeof p.correlationId !== 'string') return;
      const entry = this.pending.get(p.correlationId);
      if (!entry || entry.settled) return;
      entry.settled = true;
      clearTimeout(entry.timer);
      this.pending.delete(p.correlationId);
      if (typeof p.error === 'string') {
        entry.reject(new Error(p.error));
      } else {
        entry.resolve(p.result);
      }
    });
  }

  private generateCorrelationId(): string {
    // Correlation ids only need to be unique within one extension's view
    // iframe for the lifetime of one pending request. Math.random twice
    // concatenated gives ~15 bytes of entropy which is more than enough.
    return (
      Math.random().toString(36).slice(2, 15) +
      Math.random().toString(36).slice(2, 15)
    );
  }

  // ── worker-side: onRequest / delivery / abort ──────────────────────────

  /**
   * Register a handler for `id`. Overwrites any previous handler for the
   * same id; extensions that need fan-out can branch inside the handler.
   */
  onRequest(id: string, handler: ViewRequestHandler): () => void {
    this.handlers.set(id, handler);
    return () => {
      if (this.handlers.get(id) === handler) this.handlers.delete(id);
    };
  }

  /**
   * Install the worker-side delivery shim. This method exists so tests can
   * trigger the listener installation explicitly; the worker entry-point
   * factory calls it once at bootstrap.
   *
   * The SDK inspects every `asyar:action:execute` message for a top-level
   * `__rpc__` discriminator and routes RPC envelopes here. The glue lives
   * in the worker entry factory (it has the `window` handle). This class
   * only exposes [`deliverActionPayload`] so the factory can feed one
   * payload at a time.
   */
  installWorkerMessageListener(): void {
    // No-op: the wiring lives in the worker entry factory. This method
    // makes the SDK surface symmetric with the view-side equivalent and
    // gives tests a stable hook that doesn't drag in the factory.
  }

  /**
   * Test + factory entry: hand one `asyar:action:execute` payload to the
   * RPC dispatcher. Non-RPC payloads are ignored (the factory should not
   * call this for those; tests do).
   */
  deliverActionPayload(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;
    const p = payload as {
      __rpc__?: unknown;
      id?: unknown;
      correlationId?: unknown;
      payload?: unknown;
    };
    if (p.__rpc__ === 'request') {
      if (typeof p.id !== 'string' || typeof p.correlationId !== 'string') return;
      this.dispatchRequest(p.id, p.correlationId, p.payload);
    } else if (p.__rpc__ === 'abort') {
      if (typeof p.correlationId !== 'string') return;
      this.dispatchAbort(p.correlationId);
    }
  }

  private dispatchRequest(id: string, correlationId: string, payload: AnyPayload): void {
    const handler = this.handlers.get(id);
    if (!handler) {
      this.broker
        .invoke<void>('state:rpcReply', {
          correlationId,
          error: `No handler registered for RPC id "${id}"`,
        })
        .catch(() => {});
      return;
    }
    const controller = new AbortController();
    this.inFlight.set(correlationId, { controller });

    void (async () => {
      try {
        const result = await handler(payload, controller.signal);
        this.inFlight.delete(correlationId);
        await this.broker
          .invoke<void>('state:rpcReply', { correlationId, result })
          .catch(() => {});
      } catch (err) {
        this.inFlight.delete(correlationId);
        const msg = err instanceof Error ? err.message : String(err);
        await this.broker
          .invoke<void>('state:rpcReply', { correlationId, error: msg })
          .catch(() => {});
      }
    })();
  }

  private dispatchAbort(correlationId: string): void {
    const h = this.inFlight.get(correlationId);
    if (!h) return;
    h.controller.abort();
    this.inFlight.delete(correlationId);
  }
}

export const extensionRpc = new ExtensionRpc();
