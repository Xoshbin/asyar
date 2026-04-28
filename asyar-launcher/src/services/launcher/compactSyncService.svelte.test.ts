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
