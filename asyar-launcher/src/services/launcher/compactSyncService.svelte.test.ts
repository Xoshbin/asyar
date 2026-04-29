/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../theme/nativeBarSync', () => ({
  startNativeBarStyleSync: vi.fn(),
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
import { LAUNCHER_HEIGHT_DEFAULT } from '../../lib/launcher/launcherGeometry';

interface MutableDeps {
  initialized: boolean;
  launchView: string;
  activeView: unknown;
  activeContext: unknown;
  localSearchValue: string;
  isSearchLoading: boolean;
  currentDiagnosticSeverity: import('asyar-sdk/contracts').Severity | null;
  lastCompletedQuery: string | null;
}

function makeDeps(overrides: Partial<MutableDeps> = {}): { state: MutableDeps; deps: CompactSyncDeps } {
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
    expect(invoke).toHaveBeenNthCalledWith(2, 'set_launcher_keep_expanded', { keepExpanded: false });
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
    expect(invoke).toHaveBeenCalledWith('set_launcher_height', expect.objectContaining({
      height: 96,
      expanded: false,
    }));
    const shrinkCall = vi.mocked(invoke).mock.calls.find((c) => c[0] === 'set_launcher_height');
    expect((shrinkCall?.[1] as { deferUntilNextCaCommit?: boolean }).deferUntilNextCaCommit).toBeUndefined();
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
    expect((growCall?.[1] as { deferUntilNextCaCommit?: boolean }).deferUntilNextCaCommit).toBeUndefined();
  });
});
