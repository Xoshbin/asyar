// Idle-time scheduling helpers.
//
// WebKit ships requestIdleCallback behind a feature flag; the launcher flips
// it at startup via private SPI (`configure_launcher_webkit_features` in
// src-tauri/src/platform/macos.rs), but that flip is best-effort and
// version-fragile by design. This module keeps idle scheduling a pure
// optimization: a setTimeout-based fallback is installed when the native API
// is missing, and non-critical work routed through `runWhenIdle` yields to
// first paint / input handling whenever native idle scheduling exists.

type IdleDeadlineLike = {
  readonly didTimeout: boolean;
  timeRemaining(): number;
};

type IdleTask = (deadline: IdleDeadlineLike) => void;

/** Frame budget the fallback's deadline pretends to have. */
const FALLBACK_BUDGET_MS = 50;

/** Latest acceptable start when a caller doesn't give one. */
const DEFAULT_TIMEOUT_MS = 2000;

let installed = false;

/**
 * Installs `window.requestIdleCallback` / `cancelIdleCallback` when the
 * engine doesn't provide them. Called from +layout.svelte at component init
 * so every route (launcher, settings, hud, onboarding) is covered before
 * any consumer schedules work; `runWhenIdle` also self-installs.
 *
 * The fallback fires at the caller's `timeout` deadline rather than "soon":
 * without native idle detection, running early would land squarely inside
 * startup work, and the deadline is the only point we know is past it.
 */
export function installIdleCallbackPolyfill(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  if (typeof window.requestIdleCallback === 'function') return;

  const shim = (cb: IdleTask, opts?: { timeout?: number }): number => {
    const start = Date.now();
    return window.setTimeout(() => {
      cb({
        didTimeout: true,
        timeRemaining: () => Math.max(0, FALLBACK_BUDGET_MS - (Date.now() - start)),
      });
    }, opts?.timeout ?? DEFAULT_TIMEOUT_MS);
  };

  (window as { requestIdleCallback?: unknown }).requestIdleCallback = shim;
  (window as { cancelIdleCallback?: unknown }).cancelIdleCallback = (id: number) =>
    window.clearTimeout(id);
}

/**
 * Schedules non-critical work for idle time. `timeout` is the latest
 * acceptable start, passed through to native requestIdleCallback (the
 * polyfill runs the task at that deadline directly).
 */
export function runWhenIdle(task: () => void, opts: { timeout?: number } = {}): void {
  if (typeof window === 'undefined') return;
  installIdleCallbackPolyfill();
  window.requestIdleCallback(() => task(), {
    timeout: opts.timeout ?? DEFAULT_TIMEOUT_MS,
  });
}
