import { invoke } from '@tauri-apps/api/core';
import { settingsService } from '../settings/settingsService.svelte';
import { logService } from '../log/logService';

/**
 * Keeps the Rust `IndexWatcher`'s user-configured scan paths in sync with
 * `settings.search.additionalScanPaths`.
 *
 * ### Why this exists
 *
 * The filesystem watcher that drives automatic application-index rescans
 * lives in Rust (`src-tauri/src/application/index_watcher.rs`) and owns
 * its own watch set. The canonical source of truth for user-configured
 * scan paths is the TS settings store (`settings.search.additionalScanPaths`).
 * This module bridges the two: on app init it pushes the current value
 * down to Rust, and on every settings change it diffs and re-pushes only
 * when the relevant field actually changed.
 *
 * ### Why not read the setting from Rust at startup?
 *
 * Rust already reads `settings.dat` directly in one place
 * (`parse_launch_view` in `lib.rs`) to seed launcher geometry before first
 * paint, but that's a deliberate exception — mirroring the full settings
 * schema on the Rust side would duplicate load-bearing shape logic. Keeping
 * Rust passive (it receives paths via a Tauri command) means the settings
 * store stays the single source of truth and Rust just follows.
 *
 * ### Lifecycle
 *
 * - Called from `appInitializer.init()` after `settingsService.initialize()`
 *   has resolved. One `unsubscribe` is returned (currently unused, since
 *   the sync runs for the app's lifetime).
 * - Idempotent: re-running `initScanPathsSync()` replaces the previous
 *   subscription — safe for HMR.
 */
let unsubscribe: (() => void) | null = null;
let lastPaths: string[] = [];

function pathsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function pushPaths(paths: string[]): Promise<void> {
  try {
    await invoke('set_application_scan_paths', { paths });
  } catch (err) {
    logService.warn(`set_application_scan_paths failed: ${err}`);
  }
}

export function initScanPathsSync(): () => void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  lastPaths = [...(settingsService.currentSettings.search.additionalScanPaths ?? [])];
  pushPaths(lastPaths);

  unsubscribe = settingsService.subscribe((s) => {
    const next = [...(s.search.additionalScanPaths ?? [])];
    if (pathsEqual(next, lastPaths)) return;
    lastPaths = next;
    pushPaths(next);
  });

  return () => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
}

/** Testing-only: reset internal state so fresh `initScanPathsSync()`
 * calls start from scratch. Do not call from production code. */
export function __resetScanPathsSyncForTest(): void {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  lastPaths = [];
}
