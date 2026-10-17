import { developerSettingsService } from '../settings/developerSettingsService.svelte';
import { settingsService } from '../settings/settingsService.svelte';
import { logService } from './logService';

let unsubscribe: (() => void) | null = null;

function pushVerboseLogging(): void {
  logService.setVerboseLogging(developerSettingsService.verboseLogging);
}

export function initVerboseLoggingSync(): () => void {
  unsubscribe?.();
  unsubscribe = null;

  pushVerboseLogging();
  unsubscribe = settingsService.subscribe(pushVerboseLogging);

  return () => {
    unsubscribe?.();
    unsubscribe = null;
  };
}

/** Testing-only: reset the module subscription between tests. */
export function __resetVerboseLoggingSyncForTest(): void {
  unsubscribe?.();
  unsubscribe = null;
}
