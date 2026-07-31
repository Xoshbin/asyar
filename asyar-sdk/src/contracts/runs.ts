export type RunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type RunKind = 'ai-chat' | 'shell-script' | 'agent' | 'custom';

export interface Run {
  id: string;
  kind: RunKind;
  label: string;
  status: RunStatus;
  extensionId?: string;
  startedAt: number;
  endedAt?: number;
  cancellable: boolean;
  errorMessage?: string;
  /**
   * Stable join key linking a run back to its dynamic command's `object_id`.
   * Set by built-in dispatch sites (scripts, agents) so the launcher can
   * surface a status dot next to the originating row without fragile label
   * matching. Format: `cmd_scripts_dyn_<dynamicId>` for a script run,
   * `cmd_agents_dyn_<agentId>` for an agent run. `undefined` for ad-hoc
   * runs (Tier 2 RunService.start calls, custom kinds, label-only runs).
   */
  subjectId?: string;
  /**
   * The caller declared this run internal plumbing rather than something
   * the user asked for, so it raises no notification, no failure toast, and
   * no launcher row. It still appears in the Runs view.
   */
  silent?: boolean;
  /**
   * Tail of the script's captured stdout/stderr — the last lines seen before
   * the run reached a terminal status. `undefined` until Phase 3 wires
   * the capture logic; absent for non-script run kinds.
   */
  tailOutput?: string;
}

export interface RunHandle {
  readonly id: string;
  write(line: string): Promise<void>;
  done(): Promise<void>;
  fail(error: string): Promise<void>;
  cancel(): Promise<void>;
  onCancel(cb: () => void): () => void;
  /**
   * True after the launcher confirms cancellation via the cancel event.
   * Note: not synchronously true after `cancel()` resolves — the event arrives on a round-trip.
   */
  readonly cancelled: boolean;
}

export interface RunStartInput {
  label: string;
  kind: RunKind;
  cancellable?: boolean;
  /**
   * Set for work the user did not ask for — a background refresh, a cache
   * warm — so its outcome stays out of notifications, the failure toast, and
   * the launcher list. Defaults to false: a run the user set off must still
   * report when it fails.
   */
  silent?: boolean;
}

export interface IRunService {
  /**
   * Start a new run. The returned handle holds a cancel-event subscription;
   * always call `done()`, `fail()`, or `cancel()` to release it.
   */
  start(input: RunStartInput): Promise<RunHandle>;
}
