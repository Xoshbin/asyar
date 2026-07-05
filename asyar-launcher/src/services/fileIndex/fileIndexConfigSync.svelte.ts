import { settingsService } from '../settings/settingsService.svelte';
import { fileIndexSetConfig } from '../../lib/ipc/fileSearchCommands';
import type { FileSearchSettings } from '../settings/types/AppSettingsType';

/**
 * Keeps Rust's `FileIndexState` config in sync with
 * `settings.fileSearch`. Mirrors `services/application/scanPathsSync.svelte.ts`:
 * on init it pushes the current value down to Rust, and on every settings
 * change it diffs and re-pushes only when `fileSearch` actually changed.
 */
let unsubscribe: (() => void) | null = null;
let lastConfig: FileSearchSettings | null = null;

function configsEqual(a: FileSearchSettings, b: FileSearchSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function pushConfig(config: FileSearchSettings): Promise<void> {
  await fileIndexSetConfig(config);
}

export function initFileIndexConfigSync(): () => void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  lastConfig = { ...settingsService.currentSettings.fileSearch };
  void pushConfig(lastConfig);

  unsubscribe = settingsService.subscribe((s) => {
    const next = { ...s.fileSearch };
    if (lastConfig && configsEqual(next, lastConfig)) return;
    lastConfig = next;
    void pushConfig(next);
  });

  return () => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
}

/** Testing-only: reset internal state so fresh `initFileIndexConfigSync()`
 * calls start from scratch. Do not call from production code. */
export function __resetFileIndexConfigSyncForTest(): void {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  lastConfig = null;
}
