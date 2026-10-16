import { viewManager } from '../../services/extension/viewManager.svelte';
import { searchStores } from '../../services/search/stores/search.svelte';
import { getCompactSyncService } from '../../services/launcher/compactSyncService.svelte';
import { logService } from '../../services/log/logService';
import { registerLauncherResetHook } from '../ipc/windowCommands';

// The reset mechanism is instruction-driven: callers explicitly request root
// search, while Rust owns the elapsed-time pop-to-root policy and deadline.
// goBack() must strictly shrink the stack; bail out if it does not rather than
// spin forever.
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

// Invert dependency: register with windowCommands so low-level IPC does not import launcherReset
registerLauncherResetHook(resetLauncherState);
