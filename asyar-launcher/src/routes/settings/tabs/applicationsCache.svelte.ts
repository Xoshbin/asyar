import { getDefaultAppScanPaths, listApplications } from '../../../lib/ipc/commands';
import type { Application } from '../../../bindings';

export type IndexedApp = Application & { id: string };

export function withIds(list: Application[]): IndexedApp[] {
  return list.filter((a): a is IndexedApp => typeof a.id === 'string' && a.id.length > 0);
}

/**
 * In-memory copy of the application list for the Applications tab, so revisiting
 * the tab paints immediately and refreshes silently instead of showing a spinner.
 */
export const applicationsCache = $state({
  defaultPaths: [] as string[],
  apps: [] as IndexedApp[],
  hasLoadedOnce: false,
});

let inflight: Promise<void> | null = null;

/** Fetch paths and apps once and store them. Concurrent callers share one request. */
export function refreshApplicationsCache(userPaths: string[]): Promise<void> {
  inflight ??= (async () => {
    try {
      const [paths, loaded] = await Promise.all([
        getDefaultAppScanPaths(),
        listApplications(userPaths),
      ]);
      applicationsCache.defaultPaths = paths ?? [];
      applicationsCache.apps = withIds(loaded ?? []);
      applicationsCache.hasLoadedOnce = true;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Kick off a background load; failures surface later when the tab loads itself. */
export function preloadApplications(userPaths: string[]): void {
  if (applicationsCache.hasLoadedOnce) return;
  void refreshApplicationsCache(userPaths).catch(() => {});
}

export function resetApplicationsCache(): void {
  applicationsCache.defaultPaths = [];
  applicationsCache.apps = [];
  applicationsCache.hasLoadedOnce = false;
  inflight = null;
}
