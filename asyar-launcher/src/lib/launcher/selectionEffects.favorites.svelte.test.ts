/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import type { LauncherState } from './launcherState.svelte';

const mockActions = vi.hoisted(
  () =>
    new Map<
      string,
      { id: string; label: string; execute: () => Promise<void> | void; category?: string }
    >(),
);

vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: {
    registerAction: (action: {
      id: string;
      label: string;
      execute: () => Promise<void> | void;
      category?: string;
    }) => {
      mockActions.set(action.id, action);
    },
    unregisterAction: (id: string) => {
      mockActions.delete(id);
    },
    clearActionsForExtension: vi.fn(),
    setContext: vi.fn(),
  },
}));

const mockSearchOrchestrator = vi.hoisted(() => ({
  handleSearch: vi.fn().mockResolvedValue(undefined),
}));
const mockInvalidateCache = vi.hoisted(() => vi.fn());
vi.mock('../../services/search/searchOrchestrator.svelte', () => ({
  searchOrchestrator: mockSearchOrchestrator,
  invalidateTopItemsCache: mockInvalidateCache,
  warmIfTier2: vi.fn(),
}));

const mockCommands = vi.hoisted(() => ({
  setItemFavorite: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../lib/ipc/commands', () => mockCommands);

const mockFeedbackService = vi.hoisted(() => ({
  showHUD: vi.fn().mockResolvedValue(undefined),
  report: vi.fn(),
}));
vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: mockFeedbackService,
}));

vi.mock('../../services/search/stores/search.svelte', () => ({
  searchStores: { selectedIndex: 0, query: '' },
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

vi.mock('../classifyItems', () => ({
  classifyItems: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('../../services/extension/extensionManager.svelte', () => ({
  default: {
    getManifestById: () => undefined,
  },
}));

import { setupSelectionEffects } from './selectionEffects.svelte';

let cleanup = () => {};

afterEach(() => {
  cleanup();
  mockActions.clear();
  vi.clearAllMocks();
});

describe('selectionEffects - favorites lifecycle', () => {
  it('registers favorite_item when an un-favorited application is selected', async () => {
    const selectedItem = {
      objectId: 'app_finder',
      name: 'Finder',
      type: 'application' as const,
      favorite: false,
    };

    let currentItem: any = $state(null);

    const mockCloseActionList = vi.fn();
    const state = {
      searchItems: [selectedItem],
      activeViewVal: null,
      lastActiveViewId: null,
      localSearchValue: '',
      activeContext: null,
      shortcuts: [],
      selectedIndexVal: 0,
      get currentSelectedItemOriginal() {
        return currentItem;
      },
      set currentSelectedItemOriginal(v) {
        currentItem = v;
      },
      searchResultItemsMapped: [],
      getBottomBar: () => ({ closeActionList: mockCloseActionList }),
    } as unknown as LauncherState;

    cleanup = $effect.root(() => setupSelectionEffects(state));
    flushSync();

    expect(mockActions.has('favorite_item')).toBe(true);
    expect(mockActions.has('unfavorite_item')).toBe(false);
    expect(mockActions.get('favorite_item')?.label).toBe('Add to favorites');

    // Execute the action
    await mockActions.get('favorite_item')?.execute();

    expect(mockCommands.setItemFavorite).toHaveBeenCalledWith('app_finder', true);
    expect(mockInvalidateCache).toHaveBeenCalled();
    expect(mockSearchOrchestrator.handleSearch).toHaveBeenCalledWith('');
    expect(mockCloseActionList).toHaveBeenCalled();
    expect(mockFeedbackService.showHUD).not.toHaveBeenCalled();
  });

  it('registers unfavorite_item when a favorited command is selected', async () => {
    const selectedItem = {
      objectId: 'cmd_notes_new',
      name: 'New Note',
      type: 'command' as const,
      favorite: true,
    };

    let currentItem: any = $state(null);

    const mockCloseActionList = vi.fn();
    const state = {
      searchItems: [selectedItem],
      activeViewVal: null,
      lastActiveViewId: null,
      localSearchValue: '',
      activeContext: null,
      shortcuts: [],
      selectedIndexVal: 0,
      get currentSelectedItemOriginal() {
        return currentItem;
      },
      set currentSelectedItemOriginal(v) {
        currentItem = v;
      },
      searchResultItemsMapped: [],
      getBottomBar: () => ({ closeActionList: mockCloseActionList }),
    } as unknown as LauncherState;

    cleanup = $effect.root(() => setupSelectionEffects(state));
    flushSync();

    expect(mockActions.has('unfavorite_item')).toBe(true);
    expect(mockActions.has('favorite_item')).toBe(false);
    expect(mockActions.get('unfavorite_item')?.label).toBe('Remove from favorites');

    // Execute the action
    await mockActions.get('unfavorite_item')?.execute();

    expect(mockCommands.setItemFavorite).toHaveBeenCalledWith('cmd_notes_new', false);
    expect(mockInvalidateCache).toHaveBeenCalled();
    expect(mockSearchOrchestrator.handleSearch).toHaveBeenCalledWith('');
    expect(mockCloseActionList).toHaveBeenCalled();
    expect(mockFeedbackService.showHUD).not.toHaveBeenCalled();
  });

  it('unregisters both favorite actions when an un-indexable item is selected', async () => {
    let currentItem: any = $state({
      objectId: 'ext_result_123',
      type: 'result',
      favorite: false,
    });

    const state = {
      searchItems: [],
      activeViewVal: null,
      lastActiveViewId: null,
      localSearchValue: '',
      activeContext: null,
      shortcuts: [],
      selectedIndexVal: 0,
      get currentSelectedItemOriginal() {
        return currentItem;
      },
      set currentSelectedItemOriginal(v) {
        currentItem = v;
      },
      searchResultItemsMapped: [],
      getBottomBar: () => ({ closeActionList: vi.fn() }),
    } as unknown as LauncherState;

    cleanup = $effect.root(() => setupSelectionEffects(state));
    flushSync();

    expect(mockActions.has('favorite_item')).toBe(false);
    expect(mockActions.has('unfavorite_item')).toBe(false);
  });
});
