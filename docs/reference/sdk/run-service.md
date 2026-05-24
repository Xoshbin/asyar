### 8.31 `RunService` — Track long-running work in the launcher's runs UI

**Runs in:** worker (recommended).

**Permission required:** `runs:track`.

`RunService` lets an extension surface ongoing work in the launcher's runs UI, the compact HUD badge, and the tray — even when the extension panel is closed. Starting a run creates a live row that the user can monitor or cancel. When the run finishes or fails, the launcher transitions the row accordingly and, on failure, keeps it visible until the user dismisses it.

```typescript
export type RunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type RunKind = 'ai-chat' | 'shell-script' | 'agent' | 'custom';

export interface Run {
  id: string;
  kind: RunKind;
  label: string;
  status: RunStatus;
  extensionId?: string;
  startedAt: number;          // Unix ms
  endedAt?: number;           // Unix ms; set when the run reaches a terminal status
  cancellable: boolean;
  errorMessage?: string;      // Populated by fail()
  /**
   * Stable join key linking this run back to its dynamic command's object_id.
   * Set only by built-in dispatch sites (scripts, agents).
   * Undefined for ad-hoc runs started via RunService.start().
   * See the subjectId section below.
   */
  subjectId?: string;
}

export interface RunHandle {
  readonly id: string;

  /** Append a line of output to this run's log. */
  write(line: string): Promise<void>;

  /** Signal successful completion. Releases the cancel-event subscription. */
  done(): Promise<void>;

  /** Signal failure with an error message. Releases the cancel-event subscription. */
  fail(error: string): Promise<void>;

  /** Request cancellation of this run. Releases the cancel-event subscription. */
  cancel(): Promise<void>;

  /**
   * Register a callback that fires when the launcher confirms cancellation.
   * Returns an unsubscribe function.
   */
  onCancel(cb: () => void): () => void;

  /**
   * True after the launcher confirms cancellation via the cancel event.
   * Not synchronously true after cancel() resolves — the flag is set
   * on the event round-trip.
   */
  readonly cancelled: boolean;
}

export interface RunStartInput {
  label: string;
  kind: RunKind;
  cancellable?: boolean; // Defaults to false
}

export interface IRunService {
  /**
   * Start a new run. Returns a handle that holds a cancel-event subscription.
   * Always resolve the handle by calling exactly one of done(), fail(), or cancel()
   * to release the subscription.
   */
  start(input: RunStartInput): Promise<RunHandle>;
}
```

**Usage:**

```typescript
import type { IRunService } from 'asyar-sdk/contracts';

const runs = context.getService<IRunService>('runs');

const handle = await runs.start({
  label: 'Syncing contacts',
  kind: 'custom',
  cancellable: true,
});

handle.onCancel(() => {
  // Stop your work when the user requests cancellation.
  controller.abort();
});

try {
  await handle.write('Fetching remote data…');
  await doWork(handle);
  await handle.done();
} catch (err) {
  await handle.fail(err instanceof Error ? err.message : String(err));
}
```

**Cancellation contract:**

`onCancel(cb)` registers a callback that fires when the launcher emits the cancel event for this run's id. You can register multiple callbacks; each call returns its own unsubscribe function.

`cancelled` becomes `true` only after the cancel event arrives (an asynchronous round-trip from the launcher). Calling `cancel()` on the handle does not synchronously set the flag — there may be a brief window between the `cancel()` call resolving and `cancelled` being `true`. Design your handler to react to the `onCancel` callback rather than polling `cancelled`.

All three terminal methods — `done()`, `fail()`, and `cancel()` — release the cancel-event subscription via a `finally` block in the proxy. The subscription is also self-released when the cancel event arrives for your run id. If neither happens (e.g. the broker call throws on `cancel()`), the `finally` block in `cancel()` ensures the subscription is still removed rather than leaking for the lifetime of the worker iframe.

**The `subjectId` field:**

`subjectId` is a join key that links a run row back to a dynamic command's `object_id`, so the launcher can render a status dot next to the originating item without fragile label matching.

Built-in dispatch sites set this field automatically:
- Script runs: `cmd_scripts_dyn_<dynamicId>`
- Agent runs: `cmd_agents_dyn_<agentId>` (all concurrent threads of one agent share the same `subjectId`, so they share a single status dot)

Ad-hoc runs started through `RunService.start()` — including all Tier 2 extension runs — leave `subjectId` undefined. These runs appear in the runs UI and the compact HUD aggregate counts, but no per-row status dot is shown for any launcher item because there is no item to attribute them to.

If you are building a Tier 2 extension that starts runs on behalf of a dynamic command it registered, you currently cannot set `subjectId` via `RunStartInput` — the field is not part of the public SDK input type. The dot mechanism is reserved for built-in dispatch sites. See [../../explanation/run-tracking.md](../../explanation/run-tracking.md) for a full account of how run rows and status dots interact.

**Placement guidance:**

Register and drive runs from the worker. The worker survives while the view is Dormant (evicted ~2 minutes after the panel closes), so a run started from the worker will keep emitting state-changed events even when the user is not looking at your extension. Starting a run from the view is technically possible (the proxy is worker-only, enforcing this automatically) but the intent is that long-lived runs outlast the view's lifecycle.

Each handle must be resolved by exactly one of `done()`, `fail()`, or `cancel()`. Leaving a handle unresolved does not terminate the run row on the launcher side — the run will appear stuck as active until the launcher process restarts.

---
