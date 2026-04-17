// Pure derivation helpers for the compact launch view. Kept free of Svelte
// runes and Tauri imports so they're trivially unit-testable — the stateful
// wiring lives in compactSyncService.svelte.ts.

import {
  LAUNCHER_HEIGHT_COMPACT,
  LAUNCHER_HEIGHT_DEFAULT,
} from '../../lib/launcher/launcherGeometry';

export interface SearchSettledInputs {
  currentError: unknown;
  localSearchValue: string;
  isSearchLoading: boolean;
  lastCompletedQuery: string | null;
}

export interface CompactIdleInputs {
  initialized: boolean;
  launchView: string;
  compactExpanded: boolean;
  activeView: unknown;
  localSearchValue: string;
  searchExpandSticky: boolean;
}

/**
 * True when the current query has either produced results or errored —
 * i.e. the window may safely expand without flashing stale items.
 */
export function isSearchSettled(i: SearchSettledInputs): boolean {
  if (i.currentError !== null) return true;
  return (
    !!i.localSearchValue &&
    !i.isSearchLoading &&
    i.lastCompletedQuery === i.localSearchValue
  );
}

/**
 * True when the launcher should display its compact 96px form. The
 * `initialized` gate is load-bearing: Rust seeds the window geometry from
 * persisted settings during setup_app, and letting this effect run against
 * DEFAULT_SETTINGS would clobber that seed with a 560px resize.
 */
export function isCompactIdle(i: CompactIdleInputs): boolean {
  return (
    i.initialized &&
    i.launchView === 'compact' &&
    !i.compactExpanded &&
    !i.activeView &&
    (!i.localSearchValue || !i.searchExpandSticky)
  );
}

/** Target NSWindow / inner-size height for the current compact-idle state. */
export function targetHeight(compactIdle: boolean): number {
  return compactIdle ? LAUNCHER_HEIGHT_COMPACT : LAUNCHER_HEIGHT_DEFAULT;
}
