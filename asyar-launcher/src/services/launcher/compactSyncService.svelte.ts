// Compact launch-view synchronization service.
//
// Owns the reactive "compact vs expanded" decision, mirrors query presence
// into Rust's AppState, and schedules setLauncherHeight via double-rAF so
// the window grows AFTER WebKit has composited the new results (no stale-
// frame flash).
//
// The component supplies read-only getters for its reactive state; the
// service calls them inside effects driven from the component's $effect
// scope so Svelte's reactivity graph picks up dependencies automatically.

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  setLauncherHeight,
  markLauncherReady,
  setLauncherHasQuery,
} from '../../lib/ipc/commands';
import { startNativeBarStyleSync } from '../theme/nativeBarSync';
import { logService } from '../log/logService';
import {
  isSearchSettled as computeSearchSettled,
  isCompactIdle as computeCompactIdle,
  targetHeight,
} from './compactSyncLogic';

export interface CompactSyncDeps {
  getInitialized: () => boolean;
  getLaunchView: () => string;
  getActiveView: () => unknown;
  getLocalSearchValue: () => string;
  getIsSearchLoading: () => boolean;
  getCurrentError: () => unknown;
  getLastCompletedQuery: () => string | null;
}

export class CompactSyncService {
  compactExpanded = $state(false);
  searchExpandSticky = $state(false);

  #lastApplied = -1;
  #pendingRaf1 = 0;
  #pendingRaf2 = 0;
  #lastHasQuery: boolean | null = null;
  #deps: CompactSyncDeps;

  constructor(deps: CompactSyncDeps) {
    this.#deps = deps;
  }

  get isSearchSettled(): boolean {
    return computeSearchSettled({
      currentError: this.#deps.getCurrentError(),
      localSearchValue: this.#deps.getLocalSearchValue(),
      isSearchLoading: this.#deps.getIsSearchLoading(),
      lastCompletedQuery: this.#deps.getLastCompletedQuery(),
    });
  }

  get isCompactIdle(): boolean {
    return computeCompactIdle({
      initialized: this.#deps.getInitialized(),
      launchView: this.#deps.getLaunchView(),
      compactExpanded: this.compactExpanded,
      activeView: this.#deps.getActiveView(),
      localSearchValue: this.#deps.getLocalSearchValue(),
      searchExpandSticky: this.searchExpandSticky,
    });
  }

  /**
   * Updates the sticky expand gate. Call from a component $effect —
   * sticky flips true once the in-flight search for the current query
   * has settled, and resets when the query becomes empty.
   */
  updateSearchExpandSticky(): void {
    if (!this.#deps.getLocalSearchValue()) {
      this.searchExpandSticky = false;
    } else if (this.isSearchSettled) {
      this.searchExpandSticky = true;
    }
  }

  /**
   * Mirrors query presence into Rust's AppState so the panel resign
   * handler can tell a typed-query expansion from a transient Show More
   * click. No-ops if the boolean hasn't flipped.
   */
  syncHasQuery(): void {
    const hasQuery = !!this.#deps.getLocalSearchValue();
    if (hasQuery === this.#lastHasQuery) return;
    this.#lastHasQuery = hasQuery;
    setLauncherHasQuery(hasQuery).catch((e) =>
      logService.debug(`[compact] setLauncherHasQuery failed: ${e}`),
    );
  }

  /**
   * Schedules setLauncherHeight via double-rAF — lets WebKit composite
   * newly-arrived results into the cropped-away region before AppKit
   * grows the window, and gives Svelte a frame to finish first-mount
   * hydration before we touch NSWindow.
   */
  applyLauncherHeight(): void {
    const compactIdle = this.isCompactIdle;
    const height = targetHeight(compactIdle);
    if (height === this.#lastApplied) return;
    this.#lastApplied = height;
    if (this.#pendingRaf1) {
      cancelAnimationFrame(this.#pendingRaf1);
      this.#pendingRaf1 = 0;
    }
    if (this.#pendingRaf2) {
      cancelAnimationFrame(this.#pendingRaf2);
      this.#pendingRaf2 = 0;
    }
    this.#pendingRaf1 = requestAnimationFrame(() => {
      this.#pendingRaf2 = requestAnimationFrame(() => {
        this.#pendingRaf2 = 0;
        setLauncherHeight(height, !compactIdle).catch((e) =>
          logService.debug(`[compact] setLauncherHeight failed: ${e}`),
        );
      });
      this.#pendingRaf1 = 0;
    });
  }

  /**
   * One-shot onMount wiring: starts native-bar color sync, installs the
   * show-more-clicked / did_resign_key listeners, and reveals the native
   * Show More bar on first paint. Returns a teardown closure.
   */
  onMount(): () => void {
    startNativeBarStyleSync();
    const unlistens: UnlistenFn[] = [];

    listen('launcher:show-more-clicked', () => {
      this.compactExpanded = true;
    })
      .then((fn) => unlistens.push(fn))
      .catch((e) =>
        logService.debug(`[compact] listen show-more-clicked failed: ${e}`),
      );

    listen('main_panel_did_resign_key', () => {
      this.compactExpanded = false;
    })
      .then((fn) => unlistens.push(fn))
      .catch((e) =>
        logService.debug(`[compact] listen did_resign_key failed: ${e}`),
      );

    // Single rAF (not double): lines `setHidden:NO` up with WebKit's first
    // painted frame. Double would be one frame too late and the bar would
    // appear above a still-blank search header.
    requestAnimationFrame(() => {
      markLauncherReady(!this.isCompactIdle).catch((e) =>
        logService.debug(`[compact] markLauncherReady failed: ${e}`),
      );
    });

    return () => {
      for (const fn of unlistens) fn();
      if (this.#pendingRaf1) cancelAnimationFrame(this.#pendingRaf1);
      if (this.#pendingRaf2) cancelAnimationFrame(this.#pendingRaf2);
      this.#pendingRaf1 = 0;
      this.#pendingRaf2 = 0;
    };
  }
}
