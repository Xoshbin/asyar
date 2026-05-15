import { BaseServiceProxy } from './BaseServiceProxy';
import type { IRunService, RunStartInput, RunHandle } from '../contracts/runs';

const CANCEL_EVENT = 'asyar:event:runs:cancel';

/** SDK-side proxy for the Run Tracker service. */
export class RunServiceProxy extends BaseServiceProxy implements IRunService {
  /** Start a new run and return a handle for writing output and signalling completion. */
  async start(input: RunStartInput): Promise<RunHandle> {
    const id = crypto.randomUUID();
    const kind = input.kind;
    const label = input.label;
    const cancellable = input.cancellable ?? false;

    await this.broker.invoke('runs:start', { id, kind, label, cancellable });

    return this.buildHandle(id);
  }

  private buildHandle(id: string): RunHandle {
    const broker = this.broker;
    let cancelled = false;
    const callbacks = new Set<() => void>();

    const handler = (payload: unknown) => {
      const p = payload as { id: string } | undefined;
      if (p?.id !== id) return;
      cancelled = true;
      for (const cb of callbacks) cb();
      broker.off(CANCEL_EVENT, handler);
    };

    broker.on(CANCEL_EVENT, handler);

    const unsubscribeAll = () => {
      broker.off(CANCEL_EVENT, handler);
    };

    return {
      get id() { return id; },
      get cancelled() { return cancelled; },

      /** Write a line of output to this run. */
      async write(line: string) {
        await broker.invoke('runs:write', { id, line });
      },

      /** Signal that the run completed successfully. */
      async done() {
        await broker.invoke('runs:done', { id });
        unsubscribeAll();
      },

      /** Signal that the run failed with the given error message. */
      async fail(error: string) {
        await broker.invoke('runs:fail', { id, error });
        unsubscribeAll();
      },

      /** Request cancellation of this run. */
      async cancel() {
        try {
          await broker.invoke('runs:cancel', { id });
        } finally {
          // Release the cancel-event subscription regardless of whether the
          // broker call resolved. On success the launcher emits
          // `asyar:event:runs:cancel` and the handler self-unsubs anyway;
          // on failure (unknown id, etc.) no event ever arrives — without
          // this `finally` the subscription would leak for the lifetime of
          // the worker iframe.
          unsubscribeAll();
        }
      },

      /** Register a callback that fires when this run is cancelled. Returns an unsubscribe function. */
      onCancel(cb: () => void) {
        callbacks.add(cb);
        return () => {
          callbacks.delete(cb);
        };
      },
    };
  }
}
