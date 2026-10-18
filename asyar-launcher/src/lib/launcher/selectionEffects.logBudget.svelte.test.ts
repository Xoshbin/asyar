/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import type { LauncherState } from './launcherState.svelte';

const tauriSinks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-log', () => ({
  ...tauriSinks,
  attachConsole: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../searchResultMapper', () => ({
  buildMappedItems: ({ searchItems }: { searchItems: Array<Record<string, unknown>> }) => ({
    mappedItems: [],
    selectedOriginal: searchItems[0] ? { ...searchItems[0] } : null,
  }),
}));
vi.mock('../../services/search/searchOrchestrator.svelte', () => ({
  searchOrchestrator: { items: [], handleSearch: vi.fn() },
  invalidateTopItemsCache: vi.fn(),
  warmIfTier2: vi.fn(),
}));
vi.mock('../../services/search/SearchService', () => ({
  searchService: { clearIndex: vi.fn() },
}));
vi.mock('../../services/search/stores/search.svelte', () => ({
  searchStores: { selectedIndex: 0, query: '' },
}));
vi.mock('../../services/extension/commandService.svelte', () => ({
  commandService: { liveSubtitles: new Map(), executeCommand: vi.fn() },
}));
vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { report: vi.fn(), showHUD: vi.fn(), confirmAlert: vi.fn() },
}));
vi.mock('../../services/application/applicationService', () => ({
  applicationService: { uninstallApplication: vi.fn(), scanUninstallTargets: vi.fn() },
}));
vi.mock('../../lib/ipc/commands', () => ({
  setItemFavorite: vi.fn(),
  showSettingsWindow: vi.fn(),
  hideWindow: vi.fn(),
  resetSearchIndex: vi.fn(),
  factoryReset: vi.fn(),
}));
vi.mock('../../services/settings/developerSettingsService.svelte', () => ({
  developerSettingsService: {
    isDeveloperMode: false,
    showInspector: false,
    verboseLogging: false,
    tracing: false,
    allowSideloading: false,
  },
}));
vi.mock('../../services/launcher/compactSyncService.svelte', () => ({
  getCompactSyncService: () => null,
}));
vi.mock('../../built-in-features/aliases/aliasStore.svelte', () => ({
  aliasStore: { byObjectId: new Map() },
}));
vi.mock('../../services/run/runService.svelte', () => ({
  runService: {
    active: [],
    unacknowledgedFailures: [],
    keptAgents: [],
    unacknowledgedScriptResults: [],
  },
}));
vi.mock('../classifyItems', () => ({ classifyItems: vi.fn().mockResolvedValue(new Map()) }));

import { actionService } from '../../services/action/actionService.svelte';
import { logService } from '../../services/log/logService';
import { setupSelectionEffects } from './selectionEffects.svelte';

let cleanup = () => {};

afterEach(() => {
  cleanup();
  logService.setVerboseLogging(false);
  vi.clearAllMocks();
  delete (globalThis as any).__TAURI_INTERNALS__;
});

describe('selection effects log budget', () => {
  it('emits no Tauri log IPC across consecutive keystrokes with a stable selection', () => {
    (globalThis as any).__TAURI_INTERNALS__ = {};
    logService.setVerboseLogging(true);
    let query = $state('');
    let currentItem: any = $state(null);
    const state = {
      searchItems: [
        {
          objectId: 'app_finder',
          name: 'Finder',
          type: 'application' as const,
          favorite: false,
        },
      ],
      activeViewVal: null,
      lastActiveViewId: null,
      get localSearchValue() {
        return query;
      },
      activeContext: null,
      shortcuts: [],
      selectedIndexVal: 0,
      get currentSelectedItemOriginal() {
        return currentItem;
      },
      set currentSelectedItemOriginal(value) {
        currentItem = value;
      },
      searchResultItemsMapped: [],
      getBottomBar: () => null,
    } as unknown as LauncherState;

    cleanup = $effect.root(() => setupSelectionEffects(state));
    flushSync();
    Object.values(tauriSinks).forEach((sink) => sink.mockClear());

    query = 'f';
    flushSync();
    query = 'fi';
    flushSync();
    query = 'fin';
    flushSync();

    expect(tauriSinks.debug).not.toHaveBeenCalled();
    expect(tauriSinks.warn).not.toHaveBeenCalled();
    expect(tauriSinks.info).not.toHaveBeenCalled();
    expect(tauriSinks.error).not.toHaveBeenCalled();
    expect(actionService.filteredActions.some((action) => action.id === 'favorite_item')).toBe(
      true,
    );
  });
});
