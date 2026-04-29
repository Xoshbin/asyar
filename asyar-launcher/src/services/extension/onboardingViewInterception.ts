// ───────────────────────────────────────────────────────────────────────────
// onboardingViewInterception.ts
//
// Tier 2 view-mode commands bypass the Rust dispatch path (the launcher
// resolves them by calling navigateToView directly — see ExtensionLoader's
// Tier 2 view branch). Plan B's Rust dispatch interception therefore can't
// see them. This module is the parallel TS-side gate.
//
// On a user-initiated view-command execute:
//   1. Look up the extension's onboarding decl + onboarded flag.
//   2. If declared and not onboarded, stash the originally-requested view
//      target and navigate to the onboarding view's component instead.
//   3. When the extension calls `context.proxies.onboarding.complete()`,
//      Rust marks onboarded + emits `asyar:extension-onboarded`.
//   4. The listener installed below drains the stash and re-navigates to
//      the original target so the user lands where they originally asked.
// ───────────────────────────────────────────────────────────────────────────

import { listen } from '@tauri-apps/api/event';
import { logService } from '../log/logService';

interface StashedView {
  /** The launcher view path the user originally targeted, e.g.
   *  `org.asyar.sdk-playground/DefaultView`. */
  viewPath: string;
  /** Optional args carried by the original command invocation. */
  args?: Record<string, unknown>;
}

const stash = new Map<string, StashedView>();

export const onboardingViewInterception = {
  /** Stash the original view target before redirecting to onboarding. */
  put(extensionId: string, entry: StashedView): void {
    stash.set(extensionId, entry);
  },

  /** Drop without retrieving (e.g. extension uninstalled). */
  drop(extensionId: string): void {
    stash.delete(extensionId);
  },

  /** Drain — used by the `asyar:extension-onboarded` listener. */
  take(extensionId: string): StashedView | undefined {
    const entry = stash.get(extensionId);
    stash.delete(extensionId);
    return entry;
  },

  /** Read without consuming — for diagnostics / tests. */
  peek(extensionId: string): StashedView | undefined {
    return stash.get(extensionId);
  },
};

/** Installs the listener that drives post-onboarding re-navigation. Must be
 *  called once at app init, in a context where navigateToView is available. */
export function installOnboardingCompletionListener(
  navigateToView: (viewPath: string) => void,
): () => void {
  let unlisten: (() => void) | null = null;
  void (async () => {
    try {
      unlisten = await listen<{ extensionId: string }>(
        'asyar:extension-onboarded',
        ({ payload }) => {
          const entry = onboardingViewInterception.take(payload.extensionId);
          if (entry) {
            logService.debug(
              `[onboarding] re-navigating ${payload.extensionId} → ${entry.viewPath} after complete()`,
            );
            navigateToView(entry.viewPath);
          }
        },
      );
    } catch (err) {
      logService.warn(
        `[onboarding] failed to install asyar:extension-onboarded listener: ${err}`,
      );
    }
  })();
  return () => {
    if (unlisten) unlisten();
  };
}
