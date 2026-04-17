/**
 * Options for requesting an OS sleep inhibitor.
 *
 * All axes are independent — pass any combination. `system` defaults to true
 * so a bare `{ reason: '...' }` call behaves like the old `caffeinate -i`
 * shell invocation: the machine stays awake, the screen is allowed to sleep.
 */
export interface KeepAwakeOptions {
  /** Prevent system idle sleep. Default: true. */
  system?: boolean;
  /** Keep the display on. Default: false. */
  display?: boolean;
  /** Prevent disk idle. Default: false. */
  disk?: boolean;
  /** Human-readable reason — shown in OS power panels where supported. */
  reason: string;
}

export interface ResolvedKeepAwakeOptions {
  system: boolean;
  display: boolean;
  disk: boolean;
}

export interface ActiveInhibitor {
  token: string;
  options: ResolvedKeepAwakeOptions;
  reason: string;
  /** Unix seconds. */
  createdAt: number;
}

/**
 * Prevents the OS from entering sleep states while extension logic is running.
 *
 * Tokens are opaque UUIDs owned by the Rust host process. They survive iframe
 * reload — always call {@link IPowerService.list} after a reattach to
 * rediscover the inhibitors your extension held previously.
 *
 * Implementations may throw if the underlying platform cannot honor the
 * request (e.g. non-systemd Linux without logind) — the error message starts
 * with `PowerUnavailable:` in that case.
 */
export interface IPowerService {
  /**
   * Request an OS keep-awake inhibitor. Returns an opaque token used to
   * release it. Requires the `power:inhibit` manifest permission.
   */
  keepAwake(options: KeepAwakeOptions): Promise<string>;

  /** Release an inhibitor by token. */
  release(token: string): Promise<void>;

  /** List this extension's currently-active inhibitors. */
  list(): Promise<ActiveInhibitor[]>;
}
