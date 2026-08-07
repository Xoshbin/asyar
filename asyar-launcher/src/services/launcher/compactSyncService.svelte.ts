// Compact launch-view synchronization service.
//
// Owns the reactive "compact vs expanded" decision, mirrors query presence
// into Rust's AppState, and schedules setLauncherHeight through the
// presentation gate so the window geometry commits in the same CATransaction
// as the paint that swaps the chrome (no stale-frame flash).
//
// The component supplies read-only getters for its reactive state; the
// service calls them inside effects driven from the component's $effect
// scope so Svelte's reactivity graph picks up dependencies automatically.

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  cancelLauncherResize,
  confirmLauncherPaint,
  setLauncherHeight,
  setLauncherKeepExpanded,
} from '../../lib/ipc/commands';
import { LAUNCHER_HEIGHT_COMPACT } from '../../lib/launcher/launcherGeometry';
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
  getActiveContext: () => unknown;
  getLocalSearchValue: () => string;
  getIsSearchLoading: () => boolean;
  getCurrentDiagnosticSeverity: () => import('asyar-sdk/contracts').FeedbackSeverity | null;
  getLastCompletedQuery: () => string | null;
}

export class CompactSyncService {
  compactExpanded = $state(false);
  searchExpandSticky = $state(false);

  #lastApplied = -1;
  #confirmPending = false;
  #confirmRaf = 0;
  #lastKeepExpanded: boolean | null = null;
  #deps: CompactSyncDeps;

  constructor(deps: CompactSyncDeps) {
    this.#deps = deps;
  }

  get isSearchSettled(): boolean {
    return computeSearchSettled({
      currentDiagnosticSeverity: this.#deps.getCurrentDiagnosticSeverity(),
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
      activeContext: this.#deps.getActiveContext(),
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
   * Mirrors `!isCompactIdle` into Rust's AppState so the panel resign
   * handler knows whether the launcher is in a committed expanded state
   * (typed query, active extension view, active context chip, Show More
   * click) that must not be collapsed on hide. TS is the single source of
   * truth; Rust is a sink. No-ops if the boolean hasn't flipped.
   */
  syncKeepExpanded(): void {
    const keepExpanded = !this.isCompactIdle;
    if (keepExpanded === this.#lastKeepExpanded) return;
    this.#lastKeepExpanded = keepExpanded;
    setLauncherKeepExpanded(keepExpanded).catch((e) =>
      logService.debug(`[compact] setLauncherKeepExpanded failed: ${e}`),
    );
  }

  /**
   * Schedules setLauncherHeight. Every visible transition takes the
   * presentation gate: the resize request is sent at effect time so Rust's
   * commit sentinel arms ahead of this rendering update's layer-tree
   * commit, and a rAF in that same update stamps the confirm mark — the
   * sentinel then commits the window geometry and the paint that swaps the
   * chrome in one render-server commit. The Show More bar is DOM, so the
   * paint the resize must land with is always the paint that toggles the
   * bar: a grow committed early would show the new view's header through
   * the compact crop, a shrink committed early would show stale results
   * pixels where the bar belongs. No transition kind can skip the gate.
   *
   * Shrink-while-query-present is deferred: `viewManager.goBack()` can
   * restore a prior query before the search has re-settled, so
   * `isCompactIdle` transiently flips true and shrinking here would
   * flicker 96 → (settle) → 480.
   *
   * A gated resize that's already in Rust when the schedule resets is
   * withdrawn outright (`cancelLauncherResize`) and #lastApplied forgets
   * it, so the settled state re-derives the geometry instead of the Rust
   * watchdog landing it unsynchronized.
   */
  applyLauncherHeight(): void {
    const compactIdle = this.isCompactIdle;
    const height = targetHeight(compactIdle);
    if (height === this.#lastApplied) return;
    if (height === LAUNCHER_HEIGHT_COMPACT && this.#deps.getLocalSearchValue()) {
      // A compact target with query text present is always transient (the
      // search settles and re-expands, or the query clears). Still disarm
      // any pending resize: left armed, it would fire against this
      // already-settled state (the visible position bounce).
      this.#cancelPendingResize();
      return;
    }
    this.#cancelPendingResize();
    this.#lastApplied = height;
    // Forcing layout attaches the Rust-side gate to the transaction
    // carrying this frame's DOM state.
    void document.documentElement.offsetHeight;
    setLauncherHeight(height, false, true).catch((e) =>
      logService.debug(`[compact] setLauncherHeight failed: ${e}`),
    );
    this.#confirmPending = true;
    this.#confirmRaf = requestAnimationFrame(() => {
      this.#confirmRaf = 0;
      this.#confirmPending = false;
      void document.documentElement.offsetHeight;
      confirmLauncherPaint().catch((e) =>
        logService.debug(`[compact] confirmLauncherPaint failed: ${e}`),
      );
    });
  }

  /**
   * Collapse to compact while the window is hidden. The reset path mutates
   * query/view imperatively, so the reactivity graph hasn't caught up — we
   * can't lean on the isCompactIdle guard the resign-key listener uses.
   */
  resetToCompactIfConfigured(): void {
    this.compactExpanded = false;
    if (this.#deps.getLaunchView() !== 'compact') return;
    this.#shrinkToCompactNow('reset-to-compact');
  }

  #shrinkToCompactNow(tag: string): void {
    // Cancel BEFORE the no-op check: even when already compact, a pending
    // gated resize must be disarmed or it fires against the hidden window.
    this.#cancelPendingResize();
    if (this.#lastApplied === LAUNCHER_HEIGHT_COMPACT) return;
    this.#lastApplied = LAUNCHER_HEIGHT_COMPACT;
    // Ungated: the window is hidden (parked at alpha 0 on macOS), so there
    // is no interstitial to prevent and rAF-driven confirms are throttled.
    setLauncherHeight(LAUNCHER_HEIGHT_COMPACT).catch((e) =>
      logService.debug(`[compact] ${tag} shrink failed: ${e}`),
    );
  }

  #cancelPendingResize(): void {
    if (this.#confirmRaf) {
      cancelAnimationFrame(this.#confirmRaf);
      this.#confirmRaf = 0;
    }
    if (this.#confirmPending) {
      // A presentation-gated resize is already in Rust and the confirm that
      // was just cancelled will never arrive. Withdraw the request —
      // otherwise its watchdog force-applies the stale geometry — and
      // forget the applied height so the next pass re-derives from scratch.
      this.#confirmPending = false;
      this.#lastApplied = -1;
      cancelLauncherResize().catch((e) =>
        logService.debug(`[compact] cancelLauncherResize failed: ${e}`),
      );
    }
  }

  /**
   * One-shot onMount wiring: installs the did_resign_key listener.
   * Returns a teardown closure.
   */
  onMount(): () => void {
    const unlistens: UnlistenFn[] = [];

    listen('main_panel_did_resign_key', () => {
      this.compactExpanded = false;
      // rAF is paused in a hidden webview, so applyLauncherHeight's
      // scheduled shrink would miss this hide and the next prepare_show
      // would flash the cached 480 paint.
      if (this.isCompactIdle) this.#shrinkToCompactNow('resign-key');
    })
      .then((fn) => unlistens.push(fn))
      .catch((e) => logService.debug(`[compact] listen did_resign_key failed: ${e}`));

    return () => {
      for (const fn of unlistens) fn();
      this.#cancelPendingResize();
    };
  }
}

// Bridge for non-component callers (e.g. resetLauncherState) to reach the
// component-scoped instance.
let registered: CompactSyncService | null = null;

export function registerCompactSyncService(svc: CompactSyncService): void {
  registered = svc;
}

export function getCompactSyncService(): CompactSyncService | null {
  return registered;
}
