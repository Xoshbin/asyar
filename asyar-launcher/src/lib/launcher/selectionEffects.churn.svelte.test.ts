/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import type { LauncherState } from './launcherState.svelte';

const registerAction = vi.hoisted(() => vi.fn());
const unregisterAction = vi.hoisted(() => vi.fn());

vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: {
    registerAction,
    unregisterAction,
    clearActionsForExtension: vi.fn(),
    setContext: vi.fn(),
  },
}));
vi.mock('../searchResultMapper', () => ({
  buildMappedItems: ({ searchItems }: { searchItems: Array<Record<string, unknown>> }) => ({
    mappedItems: [],
    selectedOriginal: searchItems[0] ? { ...searchItems[0] } : null,
  }),
}));
vi.mock('../../services/search/searchOrchestrator.svelte', () => ({
  searchOrchestrator: { handleSearch: vi.fn() },
  invalidateTopItemsCache: vi.fn(),
  warmIfTier2: vi.fn(),
}));
vi.mock('../../lib/ipc/commands', () => ({ setItemFavorite: vi.fn() }));
vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { report: vi.fn() },
}));
vi.mock('../../services/launcher/compactSyncService.svelte', () => ({
  getCompactSyncService: () => null,
}));
vi.mock('../../services/extension/commandService.svelte', () => ({
  commandService: { liveSubtitles: new Map() },
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

import { setupSelectionEffects } from './selectionEffects.svelte';
import { searchStores } from '../../services/search/stores/search.svelte';

let cleanup = () => {};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('selectionEffects stable-selection churn', () => {
  it('does not re-register selection actions across keystrokes when selection keys stay stable', () => {
    let query = $state('');
    let currentItem: any = $state(null);
    const selected = {
      objectId: 'app_finder',
      name: 'Finder',
      type: 'application' as const,
      favorite: false,
    };
    const state = {
      searchItems: [selected],
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
    registerAction.mockClear();
    unregisterAction.mockClear();

    query = 'f';
    flushSync();
    query = 'fi';
    flushSync();

    expect(registerAction).not.toHaveBeenCalled();
    expect(unregisterAction).not.toHaveBeenCalled();
  });

  it('preserves selectedIndex when items append for the same query, but resets when query changes', () => {
    const itemsState = $state<{ list: any[] }>({
      list: [
        { objectId: 'app_1', name: 'App 1', type: 'application' as const },
        { objectId: 'app_2', name: 'App 2', type: 'application' as const },
      ],
    });
    searchStores.query = 'app';
    searchStores.selectedIndex = 0;

    const state = {
      get searchItems() {
        return itemsState.list;
      },
      activeViewVal: null,
      lastActiveViewId: null,
      localSearchValue: 'app',
      activeContext: null,
      shortcuts: [],
      selectedIndexVal: 0,
      currentSelectedItemOriginal: null,
      searchResultItemsMapped: [],
      getBottomBar: () => null,
    } as unknown as LauncherState;

    cleanup = $effect.root(() => setupSelectionEffects(state));
    flushSync();
    expect(searchStores.selectedIndex).toBe(0);

    // User arrows down to index 1
    searchStores.selectedIndex = 1;
    flushSync();
    expect(searchStores.selectedIndex).toBe(1);

    // Remote cloud results stream in and append to searchItems for the same query
    itemsState.list = [
      ...itemsState.list,
      { objectId: 'file_remote_gdrive_1', name: 'Cloud Doc', type: 'file' as const },
      { objectId: 'file_remote_gdrive_2', name: 'Cloud Sheet', type: 'file' as const },
    ];
    flushSync();

    // Selection MUST be preserved at index 1 instead of reset to 0
    expect(searchStores.selectedIndex).toBe(1);

    // Query changes: selection must reset to 0
    searchStores.query = 'app 2';
    flushSync();
    expect(searchStores.selectedIndex).toBe(0);
  });
});
