import extensionManager from '../../services/extension/extensionManager.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { searchStores } from '../../services/search/stores/search.svelte';
import { getCompactSyncService } from '../../services/launcher/compactSyncService.svelte';
import { logService } from '../../services/log/logService';

// Shared close-the-launcher reset (app launches, no-view commands,
// hide-and-reset escape) so the next open starts clean regardless of how
// the launcher was dismissed. goBack() must strictly shrink the stack; bail
// out if it doesn't rather than spin.
export function resetLauncherState(): void {
  let prev = viewManager.getNavigationStackSize();
  while (prev > 0) {
    extensionManager.goBack();
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
