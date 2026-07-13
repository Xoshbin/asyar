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
  cancelLauncherResize,
  confirmLauncherPaint,
  setLauncherHeight,
  markLauncherReady,
  setLauncherKeepExpanded,
} from '../../lib/ipc/commands';
import { LAUNCHER_HEIGHT_COMPACT } from '../../lib/launcher/launcherGeometry';
import { syncNativeBarStyle } from '../theme/nativeBarSync';
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
  #pendingTarget = -1;
  #confirmPending = false;
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
   * Schedules setLauncherHeight, routed by transition kind (an active-view
   * toggle is the signal that chrome swaps together with the resize):
   * - extension-view GROW: sent at effect time so Rust's presentation hook
   *   arms ahead of the swap's paint; a rAF in the same rendering update
   *   then confirms the paint and the hook commits the window grow and the
   *   new view's pixels in one CATransaction;
   * - extension-view SHRINK: single rAF + CA pre-commit gate; resize ASAP,
   *   the crop merely hides the results region;
   * - everything else: double rAF (Svelte first-mount hydration) + direct.
   *
   * Shrink-while-query-present is deferred: `viewManager.goBack()` can
   * restore a prior query before the search has re-settled, so
   * `isCompactIdle` transiently flips true and shrinking here would
   * flicker 96 → (settle) → 480.
   *
   * The armed resize is tracked in #pendingTarget and every fire re-derives
   * the target, so stale schedules from transient idle blips drop out
   * instead of committing an obsolete height (visible position bounce). A
   * gated grow that's already in Rust when the schedule resets is withdrawn
   * outright (`cancelLauncherResize`) and #lastApplied forgets it, so the
   * settled state re-derives the geometry instead of the Rust watchdog
   * landing it unsynchronized.
   */
  applyLauncherHeight(): void {
    const compactIdle = this.isCompactIdle;
    const height = targetHeight(compactIdle);
    // Update on every pass (including early returns) so a toggle while
    // height is unchanged or shrink-blocked still informs the next resize.
    const hadActiveView = this.#hadActiveView;
    this.#hadActiveView = !!this.#deps.getActiveView();
    // #lastApplied only advances once a resize is actually handed to Rust,
    // so compare against the armed-but-unsent target when one exists.
    const previous = this.#pendingTarget !== -1 ? this.#pendingTarget : this.#lastApplied;
    if (height === previous) return;
    const shrinking = previous !== -1 && height < previous;
    if (shrinking && this.#deps.getLocalSearchValue()) {
      // Still disarm any pending grow: left armed, it would fire against
      // this already-settled state (the visible position bounce).
      this.#cancelPendingResize();
      return;
    }
    this.#cancelPendingResize();
    this.#pendingTarget = height;
    // Re-derives the target at fire time (a stale send would fight the pass
    // that moved the state on) and forces layout so the Rust-side gates
    // attach to the transaction carrying this frame's DOM state.
    const send = (viaCaGate: boolean, viaPresentationGate: boolean) => {
      this.#pendingTarget = -1;
      const idleNow = this.isCompactIdle;
      const target = targetHeight(idleNow);
      if (target !== height) return;
      this.#lastApplied = height;
      void document.documentElement.offsetHeight;
      setLauncherHeight(height, !idleNow, viaCaGate, viaPresentationGate).catch((e) =>
        logService.debug(`[compact] setLauncherHeight failed: ${e}`),
      );
    };
    const activeViewToggled = hadActiveView !== this.#hadActiveView;
    if (activeViewToggled && previous !== -1) {
      if (shrinking) {
        // goBack to compact root: resize ASAP. One rAF for Svelte's DOM
        // swap, then the CA pre-commit gate. The crop only hides the
        // results region, so there is no paint worth waiting for.
        this.#pendingRaf1 = requestAnimationFrame(() => {
          this.#pendingRaf1 = 0;
          send(true, false);
        });
        return;
      }
      // Extension view entered: request the resize now, before this
      // rendering update builds the swap's paint, so Rust's presentation
      // hook is armed ahead of the swap's layer-tree commit and can't miss
      // it. The rAF then stamps the confirm mark from the same rendering
      // update as the swap, and the hook commits the grow on exactly that
      // paint's presentation.
      send(false, true);
      this.#confirmPending = true;
      this.#pendingRaf1 = requestAnimationFrame(() => {
        this.#pendingRaf1 = 0;
        this.#confirmPending = false;
        void document.documentElement.offsetHeight;
        confirmLauncherPaint().catch((e) =>
          logService.debug(`[compact] confirmLauncherPaint failed: ${e}`),
        );
      });
      return;
    }
    this.#pendingRaf1 = requestAnimationFrame(() => {
      this.#pendingRaf2 = requestAnimationFrame(() => {
        this.#pendingRaf2 = 0;
        send(false, false);
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
    // Cancel BEFORE the no-op check: even when already compact, a pending
    // grow must be disarmed or it fires against the hidden window.
    this.#cancelPendingResize();
    if (this.#lastApplied === LAUNCHER_HEIGHT_COMPACT) return;
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
    this.#pendingTarget = -1;
    if (this.#pendingRaf1) {
      cancelAnimationFrame(this.#pendingRaf1);
      this.#pendingRaf1 = 0;
    }
    if (this.#pendingRaf2) {
      cancelAnimationFrame(this.#pendingRaf2);
      this.#pendingRaf2 = 0;
    }
    if (this.#confirmPending) {
      // A presentation-gated grow is already in Rust and the confirm that
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
   * One-shot onMount wiring: seeds initial native-bar colors, installs the
   * show-more-clicked / did_resign_key listeners, and reveals the native
   * Show More bar on first paint. Returns a teardown closure.
   */
  onMount(): () => void {
    void syncNativeBarStyle();
    const unlistens: UnlistenFn[] = [];

    listen('launcher:show-more-clicked', () => {
      this.compactExpanded = true;
    })
      .then((fn) => unlistens.push(fn))
      .catch((e) => logService.debug(`[compact] listen show-more-clicked failed: ${e}`));

    listen('main_panel_did_resign_key', () => {
      this.compactExpanded = false;
      // rAF is paused in a hidden webview, so applyLauncherHeight's
      // scheduled shrink would miss this hide and the next prepare_show
      // would flash the cached 480 paint.
      if (this.isCompactIdle) this.#shrinkToCompactNow('resign-key');
    })
      .then((fn) => unlistens.push(fn))
      .catch((e) => logService.debug(`[compact] listen did_resign_key failed: ${e}`));

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
