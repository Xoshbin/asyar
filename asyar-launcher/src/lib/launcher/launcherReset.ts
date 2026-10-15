import { viewManager } from '../../services/extension/viewManager.svelte';
import { searchStores } from '../../services/search/stores/search.svelte';
import { getCompactSyncService } from '../../services/launcher/compactSyncService.svelte';
import { logService } from '../../services/log/logService';
import { settingsService } from '../../services/settings/settingsService.svelte';
import { registerLauncherResetHook } from '../ipc/windowCommands';

// Shared close-the-launcher reset (app launches, no-view commands,
// hide-and-reset escape) so the next open starts clean regardless of how
// the launcher was dismissed. goBack() must strictly shrink the stack; bail
// out if it doesn't rather than spin.
export function resetLauncherState(): void {
  let prev = viewManager.getNavigationStackSize();
  while (prev > 0) {
    viewManager.goBack();
    const next = viewManager.getNavigationStackSize();
    if (next >= prev) {
      logService.warn(`[launcherReset] goBack did not shrink stack (${prev} -> ${next}), aborting`);
      break;
    }
    prev = next;
  }
  searchStores.query = '';
  getCompactSyncService()?.resetToCompactIfConfigured();
}

// Reset driven by the hide itself (panel resign-key / blur) when the user
// disabled Restore Last View. Runs while the window is hidden — the parked
// webview keeps rendering (see `hide` in src-tauri commands/app.rs), so the
// reset is composited before the next reveal and the next normal summon
// shows root search with no flash of the previous view. Dedicated item
// shortcuts are a separate path (navigate via withReplacementSemantics,
// then `showWindow`); they are not cleared by this handler unless a resign
// event arrives after they have already navigated.
export function resetOnHideIfConfigured(): void {
  // Missing key (settings predating the option) preserves current behavior.
  if (settingsService.getSettings()?.general?.restoreLastView !== false) return;
  resetLauncherState();
}

// Reset driven by the Settings toggle crossing to false, while the launcher
// is usually hidden behind the Settings window. Without this, a stack parked
// while restoreLastView was on would survive the toggle (no resign-key fires
// in between) and the next normal summon would restore the old view.
// Emitted by the Settings webview (separate JS realm) as
// `asyar:restore-last-view-changed`; only a transition to false clears the
// stack — enabling the setting must keep it.
export function resetOnRestoreLastViewDisabled(value: boolean | undefined): void {
  if (value !== false) return;
  resetLauncherState();
}

// Invert dependency: register with windowCommands so low-level IPC does not import launcherReset
registerLauncherResetHook(resetLauncherState);
