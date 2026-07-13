/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../theme/nativeBarSync', () => ({
  syncNativeBarStyle: vi.fn(),
}));

vi.mock('../log/logService', () => ({
  logService: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { CompactSyncService, type CompactSyncDeps } from './compactSyncService.svelte';
import { invoke } from '@tauri-apps/api/core';
import {
  LAUNCHER_HEIGHT_COMPACT,
  LAUNCHER_HEIGHT_DEFAULT,
} from '../../lib/launcher/launcherGeometry';

interface MutableDeps {
  initialized: boolean;
  launchView: string;
  activeView: unknown;
  activeContext: unknown;
  localSearchValue: string;
  isSearchLoading: boolean;
  currentDiagnosticSeverity: import('asyar-sdk/contracts').FeedbackSeverity | null;
  lastCompletedQuery: string | null;
}

function makeDeps(overrides: Partial<MutableDeps> = {}): {
  state: MutableDeps;
  deps: CompactSyncDeps;
} {
  const state: MutableDeps = {
    initialized: true,
    launchView: 'compact',
    activeView: null,
    activeContext: null,
    localSearchValue: '',
    isSearchLoading: false,
    currentDiagnosticSeverity: null,
    lastCompletedQuery: null,
    ...overrides,
  };
  const deps: CompactSyncDeps = {
    getInitialized: () => state.initialized,
    getLaunchView: () => state.launchView,
    getActiveView: () => state.activeView,
    getActiveContext: () => state.activeContext,
    getLocalSearchValue: () => state.localSearchValue,
    getIsSearchLoading: () => state.isSearchLoading,
    getCurrentDiagnosticSeverity: () => state.currentDiagnosticSeverity,
    getLastCompletedQuery: () => state.lastCompletedQuery,
  };
  return { state, deps };
}

describe('CompactSyncService.syncKeepExpanded', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mirrors keepExpanded=false when the launcher is in the compact idle state', () => {
    const { deps } = makeDeps(); // compact + nothing active → isCompactIdle true
    const svc = new CompactSyncService(deps);

    svc.syncKeepExpanded();

    expect(invoke).toHaveBeenCalledWith('set_launcher_keep_expanded', { keepExpanded: false });
  });

  it('mirrors keepExpanded=true when an extension view is active, even with empty query', () => {
    // Regression for the reopen-in-compact bug: viewManager clears the query
    // when navigating, so a `has_query`-only proxy would say "collapse OK".
    // keepExpanded must cover activeView independently.
    const { deps } = makeDeps({ activeView: 'ext-id/view' });
    const svc = new CompactSyncService(deps);

    svc.syncKeepExpanded();

    expect(invoke).toHaveBeenCalledWith('set_launcher_keep_expanded', { keepExpanded: true });
  });

  it('mirrors keepExpanded=true when a context chip is active', () => {
    const { deps } = makeDeps({ activeContext: { provider: { id: 'google' }, query: '' } });
    const svc = new CompactSyncService(deps);

    svc.syncKeepExpanded();

    expect(invoke).toHaveBeenCalledWith('set_launcher_keep_expanded', { keepExpanded: true });
  });

  it('deduplicates — calling twice with the same state only invokes once', () => {
    const { deps } = makeDeps({ activeView: 'ext/view' });
    const svc = new CompactSyncService(deps);

    svc.syncKeepExpanded();
    svc.syncKeepExpanded();

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('re-emits when the underlying decision flips back to idle', () => {
    const { state, deps } = makeDeps({ activeView: 'ext/view' });
    const svc = new CompactSyncService(deps);

    svc.syncKeepExpanded();
    state.activeView = null;
    svc.syncKeepExpanded();

    expect(invoke).toHaveBeenNthCalledWith(1, 'set_launcher_keep_expanded', { keepExpanded: true });
    expect(invoke).toHaveBeenNthCalledWith(2, 'set_launcher_keep_expanded', {
      keepExpanded: false,
    });
  });
});

describe('CompactSyncService.resetToCompactIfConfigured', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not leave #hadActiveView stale when shrinking from an extension view', async () => {
    // Regression: resetLauncherState drains the nav stack (clears activeView)
    // and then calls resetToCompactIfConfigured. If #shrinkToCompactNow doesn't
    // refresh #hadActiveView, the next applyLauncherHeight pass sees a phantom
    // activeView toggle and routes the grow through the CA pre-commit branch
    // — which is meant for chrome-swap transitions, not idle keystrokes.
    const { state, deps } = makeDeps({ activeView: 'ext/view', launchView: 'compact' });
    const svc = new CompactSyncService(deps);

    // Seed #hadActiveView=true and #lastApplied=LAUNCHER_HEIGHT_DEFAULT by running a grow.
    svc.applyLauncherHeight();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
    vi.mocked(invoke).mockClear();

    // Simulate resetLauncherState: drain the view, then collapse.
    state.activeView = null;
    svc.resetToCompactIfConfigured();

    // The shrink itself fires the immediate (non-deferred) path.
    expect(invoke).toHaveBeenCalledWith(
      'set_launcher_height',
      expect.objectContaining({
        height: LAUNCHER_HEIGHT_COMPACT,
        expanded: false,
      }),
    );
    const shrinkCall = vi.mocked(invoke).mock.calls.find((c) => c[0] === 'set_launcher_height');
    expect(
      (shrinkCall?.[1] as { deferUntilNextCaCommit?: boolean }).deferUntilNextCaCommit,
    ).toBeUndefined();
    vi.mocked(invoke).mockClear();

    // Activate a context chip (not a view) to trigger a grow without bringing
    // back activeView. With the fix, #hadActiveView is now false, so this
    // grow has activeViewToggled=false and routes through the double-rAF
    // path (no deferUntilNextCaCommit). Without the fix, #hadActiveView is
    // still true (stale), activeViewToggled flips true, and the grow
    // mis-routes through DeferToNextCaCommit.
    state.activeContext = { provider: { id: 'google' }, query: '' };
    svc.applyLauncherHeight();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));

    const growCall = vi.mocked(invoke).mock.calls.find((c) => c[0] === 'set_launcher_height');
    expect(growCall).toBeDefined();
    expect(growCall?.[1]).toMatchObject({ height: LAUNCHER_HEIGHT_DEFAULT, expanded: true });
    const growArgs = growCall?.[1] as {
      deferUntilNextCaCommit?: boolean;
      afterNextPresentationUpdate?: boolean;
    };
    expect(growArgs.deferUntilNextCaCommit).not.toBe(true);
    expect(growArgs.afterNextPresentationUpdate).not.toBe(true);
  });
});

describe('CompactSyncService.applyLauncherHeight', () => {
  beforeEach(() => vi.clearAllMocks());

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
  const heightCalls = () =>
    vi.mocked(invoke).mock.calls.filter((c) => c[0] === 'set_launcher_height');
  const confirmCalls = () =>
    vi.mocked(invoke).mock.calls.filter((c) => c[0] === 'confirm_launcher_paint');
  const cancelCalls = () =>
    vi.mocked(invoke).mock.calls.filter((c) => c[0] === 'cancel_launcher_resize');

  /** Runs the seed pass (previous = -1 takes the ungated default path). */
  async function seedCompact(svc: CompactSyncService) {
    svc.applyLauncherHeight();
    await nextFrame();
    await nextFrame();
    vi.mocked(invoke).mockClear();
  }

  it('sends the extension-view grow at effect time and confirms the paint one frame later', async () => {
    // The grow must reach Rust BEFORE the rendering update that builds the
    // new view's paint (so the presentation hook arms ahead of the swap's
    // layer-tree commit), and confirm_launcher_paint must ride the next
    // frame, the same rendering update as the swap. A grow deferred to a
    // rAF can arm after the swap has already presented, which leaves the
    // new view's header showing through the compact crop (interstitial).
    const { state, deps } = makeDeps();
    const svc = new CompactSyncService(deps);
    await seedCompact(svc);

    state.activeView = 'ext/view';
    svc.applyLauncherHeight();

    // Synchronous send, presentation-gated, no confirm yet.
    expect(heightCalls()).toHaveLength(1);
    expect(heightCalls()[0][1]).toMatchObject({
      height: LAUNCHER_HEIGHT_DEFAULT,
      expanded: true,
      afterNextPresentationUpdate: true,
    });
    expect(confirmCalls()).toHaveLength(0);

    await nextFrame();
    expect(confirmCalls()).toHaveLength(1);
  });

  it('routes a full open → escape → reopen cycle through the right gates', async () => {
    const { state, deps } = makeDeps();
    const svc = new CompactSyncService(deps);
    await seedCompact(svc);

    state.activeView = 'ext/view';
    svc.applyLauncherHeight();
    await nextFrame();
    vi.mocked(invoke).mockClear();

    // Escape back to compact root: single rAF, CA pre-commit gate.
    state.activeView = null;
    svc.applyLauncherHeight();
    expect(heightCalls()).toHaveLength(0);
    await nextFrame();
    expect(heightCalls()).toHaveLength(1);
    expect(heightCalls()[0][1]).toMatchObject({
      height: LAUNCHER_HEIGHT_COMPACT,
      expanded: false,
      deferUntilNextCaCommit: true,
    });
    vi.mocked(invoke).mockClear();

    // Reopen: the bookkeeping from the shrink must not leak; the second
    // grow takes the same effect-time presentation-gated path as the first.
    state.activeView = 'ext/view';
    svc.applyLauncherHeight();
    expect(heightCalls()).toHaveLength(1);
    expect(heightCalls()[0][1]).toMatchObject({
      height: LAUNCHER_HEIGHT_DEFAULT,
      afterNextPresentationUpdate: true,
    });
    await nextFrame();
    expect(confirmCalls()).toHaveLength(1);
  });

  it('disarms a pending grow when a shrink is deferred by a live query', async () => {
    // Regression for the visible position bounce: goBack can restore a
    // prior query before the search re-settles, so isCompactIdle blips true
    // and the shrink is deferred. A grow armed just before that pass must
    // be cancelled with it; left armed, it fires against the settled state
    // and the window visibly jumps 96 → 480 → 96.
    const { state, deps } = makeDeps();
    const svc = new CompactSyncService(deps);
    await seedCompact(svc);

    // Settled query: sticky flips, a grow is armed (double rAF, not yet sent).
    state.localSearchValue = 'q';
    svc.searchExpandSticky = true;
    svc.applyLauncherHeight();
    expect(heightCalls()).toHaveLength(0);

    // Query restored-but-unsettled: sticky drops, shrink target while the
    // query text is still present → deferred shrink pass.
    svc.searchExpandSticky = false;
    svc.applyLauncherHeight();
    await nextFrame();
    await nextFrame();

    // Neither the armed grow nor a shrink may have reached Rust.
    expect(heightCalls()).toHaveLength(0);

    // The service isn't wedged: once the search settles again, the grow goes out.
    svc.searchExpandSticky = true;
    svc.applyLauncherHeight();
    await nextFrame();
    await nextFrame();
    expect(heightCalls()).toHaveLength(1);
    expect(heightCalls()[0][1]).toMatchObject({ height: LAUNCHER_HEIGHT_DEFAULT });
  });

  it('withdraws a sent-but-unconfirmed grow when a shrink is deferred by a live query', async () => {
    // The gated grow reaches Rust at effect time, one frame before its
    // confirm. If goBack restores a live query inside that frame, the
    // shrink is deferred and the confirm rAF is cancelled — the grow must
    // be withdrawn (cancel_launcher_resize), or Rust's watchdog would land
    // the 480 geometry unsynchronized against whatever is on screen 250ms
    // later.
    const { state, deps } = makeDeps();
    const svc = new CompactSyncService(deps);
    await seedCompact(svc);

    state.activeView = 'ext/view';
    svc.applyLauncherHeight();
    expect(heightCalls()).toHaveLength(1);

    // Before the confirm frame: view popped, prior query restored,
    // search not yet settled → deferred shrink pass.
    state.activeView = null;
    state.localSearchValue = 'q';
    svc.applyLauncherHeight();
    await nextFrame();
    await nextFrame();
    expect(cancelCalls()).toHaveLength(1);
    expect(confirmCalls()).toHaveLength(0);
    expect(heightCalls()).toHaveLength(1);

    // Settle re-derives from scratch: a plain ungated grow, not a stale
    // replay of the withdrawn one.
    svc.searchExpandSticky = true;
    svc.applyLauncherHeight();
    await nextFrame();
    await nextFrame();
    expect(heightCalls()).toHaveLength(2);
    const regrow = heightCalls()[1][1] as {
      height?: number;
      afterNextPresentationUpdate?: boolean;
    };
    expect(regrow.height).toBe(LAUNCHER_HEIGHT_DEFAULT);
    expect(regrow.afterNextPresentationUpdate).not.toBe(true);
  });
});
