/**
 * Descriptor for a scheduled one-shot timer.
 *
 * Returned from {@link ITimerService.list}; never constructed by extensions.
 * `args` is the exact object passed at schedule time — not mutated, not
 * normalised. A timer is reported here only while it is still pending
 * (`fired=false`); already-fired rows are dropped from this list even though
 * the host keeps them briefly for audit.
 */
export interface TimerDescriptor {
  timerId: string;
  extensionId: string;
  commandId: string;
  args: Record<string, unknown>;
  /** Unix millis. */
  fireAt: number;
  /** Unix millis. */
  createdAt: number;
}

export interface ScheduleTimerOptions {
  /**
   * The extension's manifest command id to invoke at `fireAt`. Same form as
   * the `id` inside a `commands[...]` entry in manifest.json.
   */
  commandId: string;
  /** Unix millis — must be strictly greater than the current clock. */
  fireAt: number;
  /**
   * Arbitrary JSON-serialisable object the extension's command receives as
   * its argument. Defaults to `{}` when omitted. Must be a plain object —
   * arrays and primitives are rejected on the host side.
   */
  args?: Record<string, unknown>;
}

/**
 * One-shot persistent timers. The host persists every scheduled timer to
 * SQLite; a fire-time elapsed while Asyar was quit is caught up at the next
 * launch.
 *
 * **Not** a recurring-timer service — use a manifest-declared `scheduler`
 * entry for periodic work. Timers survive app quit but are cleared when the
 * extension is uninstalled or disabled.
 *
 * Requires three separate manifest permissions: `timers:schedule`,
 * `timers:cancel`, and `timers:list`.
 */
export interface ITimerService {
  /**
   * Persist a new timer and return its opaque timer id. The same id can
   * later be passed to {@link cancel} or observed in {@link list}.
   */
  schedule(opts: ScheduleTimerOptions): Promise<string>;

  /**
   * Cancel a pending timer owned by this extension. Resolves even if the
   * timer has already fired (idempotent); rejects if the timer id is
   * unknown or belongs to a different extension.
   */
  cancel(timerId: string): Promise<void>;

  /** List this extension's currently-pending (not yet fired) timers. */
  list(): Promise<TimerDescriptor[]>;
}
