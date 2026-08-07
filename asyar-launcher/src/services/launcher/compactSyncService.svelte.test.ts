/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
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

  it('shrinks ungated while hidden and leaves the next grow on the gated path', async () => {
    // The reset path runs against a hidden (parked) window: rAF is
    // throttled there, so the shrink must not wait on a paint confirm.
    const { state, deps } = makeDeps({ activeView: 'ext/view', launchView: 'compact' });
    const svc = new CompactSyncService(deps);

    // Seed #lastApplied=LAUNCHER_HEIGHT_DEFAULT by running a grow.
    svc.applyLauncherHeight();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    vi.mocked(invoke).mockClear();

    // Simulate resetLauncherState: drain the view, then collapse.
    state.activeView = null;
    svc.resetToCompactIfConfigured();

    const shrinkCall = vi.mocked(invoke).mock.calls.find((c) => c[0] === 'set_launcher_height');
    expect(shrinkCall?.[1]).toMatchObject({ height: LAUNCHER_HEIGHT_COMPACT });
    const shrinkArgs = shrinkCall?.[1] as {
      deferUntilNextCaCommit?: boolean;
      afterNextPresentationUpdate?: boolean;
    };
    expect(shrinkArgs.deferUntilNextCaCommit).toBeUndefined();
    expect(shrinkArgs.afterNextPresentationUpdate).toBeUndefined();
    vi.mocked(invoke).mockClear();

    // The side-channel shrink must not derail the next visible transition:
    // a context-chip grow still takes the presentation gate.
    state.activeContext = { provider: { id: 'google' }, query: '' };
    svc.applyLauncherHeight();

    const growCall = vi.mocked(invoke).mock.calls.find((c) => c[0] === 'set_launcher_height');
    expect(growCall?.[1]).toMatchObject({
      height: LAUNCHER_HEIGHT_DEFAULT,
      afterNextPresentationUpdate: true,
    });
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

  /** Runs the seed pass (compact idle, sent gated like every transition). */
  async function seedCompact(svc: CompactSyncService) {
    svc.applyLauncherHeight();
    await nextFrame();
    vi.mocked(invoke).mockClear();
  }

  it('sends the extension-view grow at effect time and confirms the paint one frame later', async () => {
    // The grow must reach Rust BEFORE the rendering update that builds the
    // new view's paint (so the commit sentinel arms ahead of the swap's
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
      afterNextPresentationUpdate: true,
    });
    expect(confirmCalls()).toHaveLength(0);

    await nextFrame();
    expect(confirmCalls()).toHaveLength(1);
  });

  it('routes a full open → escape → reopen cycle through the presentation gate', async () => {
    const { state, deps } = makeDeps();
    const svc = new CompactSyncService(deps);
    await seedCompact(svc);

    state.activeView = 'ext/view';
    svc.applyLauncherHeight();
    await nextFrame();
    vi.mocked(invoke).mockClear();

    // Escape back to compact root: the shrink takes the same effect-time
    // gated send + next-frame confirm as the grow — the paint it must land
    // with is the one that re-shows the DOM Show More bar at the seam.
    state.activeView = null;
    svc.applyLauncherHeight();
    expect(heightCalls()).toHaveLength(1);
    expect(heightCalls()[0][1]).toMatchObject({
      height: LAUNCHER_HEIGHT_COMPACT,
      afterNextPresentationUpdate: true,
    });
    expect(confirmCalls()).toHaveLength(0);
    await nextFrame();
    expect(confirmCalls()).toHaveLength(1);
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

  it('withdraws a sticky-flip grow when a shrink is deferred by a live query', async () => {
    // Regression for the visible position bounce: goBack can restore a
    // prior query before the search re-settles, so isCompactIdle blips true
    // and the shrink is deferred. The gated grow already in Rust must be
    // withdrawn with it; left armed, its watchdog fires against the settled
    // state and the window visibly jumps 96 → 480 → 96.
    const { state, deps } = makeDeps();
    const svc = new CompactSyncService(deps);
    await seedCompact(svc);

    // Settled query: sticky flips, the gated grow goes out at effect time.
    state.localSearchValue = 'q';
    svc.searchExpandSticky = true;
    svc.applyLauncherHeight();
    expect(heightCalls()).toHaveLength(1);

    // Query restored-but-unsettled: sticky drops, shrink target while the
    // query text is still present → deferred shrink pass withdraws the
    // unconfirmed grow instead of sending anything.
    svc.searchExpandSticky = false;
    svc.applyLauncherHeight();
    await nextFrame();
    await nextFrame();
    expect(heightCalls()).toHaveLength(1);
    expect(cancelCalls()).toHaveLength(1);
    expect(confirmCalls()).toHaveLength(0);

    // The service isn't wedged: once the search settles again, a fresh
    // gated grow goes out.
    svc.searchExpandSticky = true;
    svc.applyLauncherHeight();
    expect(heightCalls()).toHaveLength(2);
    expect(heightCalls()[1][1]).toMatchObject({
      height: LAUNCHER_HEIGHT_DEFAULT,
      afterNextPresentationUpdate: true,
    });
    await nextFrame();
    expect(confirmCalls()).toHaveLength(1);
  });

  it('withdraws a sent-but-unconfirmed extension-view grow when goBack restores a query', async () => {
    // Same guard through the other entry: the gated grow reaches Rust at
    // effect time, one frame before its confirm. If goBack restores a live
    // query inside that frame, the confirm rAF is cancelled and the grow
    // must be withdrawn (cancel_launcher_resize), or Rust's watchdog would
    // land the 480 geometry unsynchronized 250ms later.
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

    // Settle re-derives from scratch: a fresh gated grow, not a stale
    // replay of the withdrawn one.
    svc.searchExpandSticky = true;
    svc.applyLauncherHeight();
    await nextFrame();
    expect(heightCalls()).toHaveLength(2);
    expect(heightCalls()[1][1]).toMatchObject({
      height: LAUNCHER_HEIGHT_DEFAULT,
      afterNextPresentationUpdate: true,
    });
    expect(confirmCalls()).toHaveLength(1);
  });
});
