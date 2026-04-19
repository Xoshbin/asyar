/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock everything the controller (and LauncherState) pulls in, so the import
// chain doesn't drag in Tauri/IPC modules.
vi.mock('../../services/search/stores/search.svelte', () => ({
  searchStores: { query: '', selectedIndex: 0, isLoading: false },
}));

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../services/search/searchOrchestrator.svelte', () => ({
  searchOrchestrator: { items: [], handleSearch: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../services/appInitializer', () => ({
  appInitializer: { init: vi.fn().mockResolvedValue(undefined), isAppInitialized: vi.fn(() => false) },
}));

vi.mock('../../services/extension/viewManager.svelte', () => ({
  viewManager: {
    activeView: null,
    activeViewSearchable: false,
    activeViewPrimaryActionLabel: null,
    activeViewSubtitle: null,
    getNavigationStackSize: vi.fn(() => 0),
    isViewActive: vi.fn(() => false),
    navigateToView: vi.fn(),
    goBack: vi.fn(),
  },
}));

vi.mock('../../services/context/contextModeService.svelte', () => ({
  contextModeService: {
    contextActivationId: null,
    activeContext: null,
    contextHint: null,
    hasStreamProvider: vi.fn(),
    isActive: vi.fn(),
    getHint: vi.fn(),
    activate: vi.fn(),
  },
  contextActivationId: null,
}));

vi.mock('../../built-in-features/shortcuts/shortcutStore.svelte', () => ({
  shortcutStore: { shortcuts: [] },
}));

// LauncherController constructor calls createSearchHandlers; stub the module
// to avoid dragging its deps.
vi.mock('./searchController.svelte', () => ({
  setupSearchEffects: vi.fn(),
  createSearchHandlers: vi.fn(() => ({
    handleSearchInput: vi.fn(),
    handleBackClick: vi.fn(),
    handleContextDismiss: vi.fn(),
    handleChipDismiss: vi.fn(),
    handleContextQueryChange: vi.fn(),
  })),
}));

vi.mock('./selectionEffects.svelte', () => ({
  setupSelectionEffects: vi.fn(),
}));

import { LauncherController } from './launcherController.svelte';
import { searchStores } from '../../services/search/stores/search.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';

describe('LauncherController.handleEnterKey — nav-stack observation guard', () => {
  let controller: LauncherController;

  beforeEach(() => {
    vi.clearAllMocks();
    searchStores.query = 'hello';
    searchStores.selectedIndex = 0;
    vi.mocked(viewManager.getNavigationStackSize).mockReturnValue(0);

    controller = new LauncherController();
    controller.state.localSearchValue = 'hello';
  });

  function selectItem(item: any) {
    controller.state.searchResultItemsMapped = [item];
  }

  it('clears search when a plain command returns undefined and does not navigate', async () => {
    selectItem({ type: 'command', action: vi.fn().mockResolvedValue(undefined) });

    await controller.handleEnterKey();

    expect(searchStores.query).toBe('');
    expect(controller.state.localSearchValue).toBe('');
  });

  it('clears search when the action returns {type:"view"} but never navigated', async () => {
    selectItem({
      type: 'command',
      action: vi.fn().mockResolvedValue({ type: 'view', path: 'ext/View' }),
    });
    vi.mocked(viewManager.getNavigationStackSize).mockReturnValue(0);

    await controller.handleEnterKey();

    expect(searchStores.query).toBe('');
    expect(controller.state.localSearchValue).toBe('');
  });

  it('does NOT clear search when the action pushed onto the nav stack during the await', async () => {
    let stackSize = 0;
    vi.mocked(viewManager.getNavigationStackSize).mockImplementation(() => stackSize);
    const action = vi.fn().mockImplementation(async () => { stackSize = 1; });

    selectItem({ type: 'command', action });

    await controller.handleEnterKey();

    expect(searchStores.query).toBe('hello');
    expect(controller.state.localSearchValue).toBe('hello');
  });

  it('does NOT clear search for non-command items (e.g. applications) even when no navigation occurred', async () => {
    selectItem({ type: 'application', action: vi.fn().mockResolvedValue(undefined) });

    await controller.handleEnterKey();

    expect(searchStores.query).toBe('hello');
    expect(controller.state.localSearchValue).toBe('hello');
  });

  it('records an error and does not clear when the action throws', async () => {
    selectItem({
      type: 'command',
      action: vi.fn().mockRejectedValue(new Error('boom')),
    });

    await controller.handleEnterKey();

    expect(controller.state.currentError).toBe('Error executing action');
    expect(searchStores.query).toBe('hello');
  });
});
