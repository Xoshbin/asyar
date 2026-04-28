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
  setLauncherKeepExpanded,
} from '../../lib/ipc/commands';
import { LAUNCHER_HEIGHT_COMPACT } from '../../lib/launcher/launcherGeometry';
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
  getActiveContext: () => unknown;
  getLocalSearchValue: () => string;
  getIsSearchLoading: () => boolean;
  getCurrentDiagnosticSeverity: () => import('asyar-sdk/contracts').Severity | null;
  getLastCompletedQuery: () => string | null;
}

export class CompactSyncService {
  compactExpanded = $state(false);
  searchExpandSticky = $state(false);

  #lastApplied = -1;
  #pendingRaf1 = 0;
  #pendingRaf2 = 0;
  #lastKeepExpanded: boolean | null = null;
  #hadActiveView = false;
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
   * Schedules setLauncherHeight via double-rAF — lets WebKit composite
   * newly-arrived results into the cropped-away region before AppKit
   * grows the window, and gives Svelte a frame to finish first-mount
   * hydration before we touch NSWindow.
   *
   * Shrink-while-query-present is deferred: `viewManager.goBack()` can
   * restore a prior query before the search has re-settled, so
   * `isCompactIdle` transiently flips true and shrinking here would
   * flicker 96 → (settle) → 560.
   *
   * Extension-view transitions route the resize through a CA pre-commit
   * gate so the NSWindow setFrame: lands in the same transaction as
   * WebKit's chrome swap (back button, placeholder).
   */
  applyLauncherHeight(): void {
    const compactIdle = this.isCompactIdle;
    const height = targetHeight(compactIdle);
    // Update on every pass (including early returns) so a toggle while
    // height is unchanged or shrink-blocked still informs the next resize.
    const hadActiveView = this.#hadActiveView;
    this.#hadActiveView = !!this.#deps.getActiveView();
    const previous = this.#lastApplied;
    if (height === previous) return;
    const shrinking = previous !== -1 && height < previous;
    if (shrinking && this.#deps.getLocalSearchValue()) return;
    this.#lastApplied = height;
    this.#cancelPendingResize();
    const activeViewToggled = hadActiveView !== this.#hadActiveView;
    if (activeViewToggled && previous !== -1) {
      // Single rAF for Svelte's DOM swap, then force a synchronous WebKit
      // layout so the new chrome is pending in the current CA transaction
      // before the Rust pre-commit gate attaches the NSWindow resize.
      this.#pendingRaf1 = requestAnimationFrame(() => {
        this.#pendingRaf1 = 0;
        void document.documentElement.offsetHeight;
        setLauncherHeight(height, !compactIdle, true).catch((e) =>
          logService.debug(`[compact] setLauncherHeight failed: ${e}`),
        );
      });
      return;
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
    if (this.#lastApplied === LAUNCHER_HEIGHT_COMPACT) return;
    this.#cancelPendingResize();
    this.#lastApplied = LAUNCHER_HEIGHT_COMPACT;
    // Mirror applyLauncherHeight's tracking write so a side-channel shrink
    // (resign-key, reset-to-compact) doesn't leave #hadActiveView stale —
    // otherwise the next applyLauncherHeight pass sees a phantom toggle and
    // mis-routes the grow through the CA pre-commit path.
    this.#hadActiveView = !!this.#deps.getActiveView();
    setLauncherHeight(LAUNCHER_HEIGHT_COMPACT, false).catch((e) =>
      logService.debug(`[compact] ${tag} shrink failed: ${e}`),
    );
  }

  #cancelPendingResize(): void {
    if (this.#pendingRaf1) {
      cancelAnimationFrame(this.#pendingRaf1);
      this.#pendingRaf1 = 0;
    }
    if (this.#pendingRaf2) {
      cancelAnimationFrame(this.#pendingRaf2);
      this.#pendingRaf2 = 0;
    }
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
      // rAF is paused in a hidden webview, so applyLauncherHeight's
      // scheduled shrink would miss this hide and the next prepare_show
      // would flash the cached 560 paint.
      if (this.isCompactIdle) this.#shrinkToCompactNow('resign-key');
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
