/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock everything the controller (and LauncherState) pulls in, so the import
// chain doesn't drag in Tauri/IPC modules.
vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { report: vi.fn(), dismiss: vi.fn() },
}));

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
  appInitializer: {
    init: vi.fn().mockResolvedValue(undefined),
    isAppInitialized: vi.fn(() => false),
  },
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

vi.mock('../listScroll', () => ({
  scrollSelectedIntoView: vi.fn(),
  resetListScroll: vi.fn(),
}));

vi.mock('../../built-in-features/shortcuts/shortcutStore.svelte', () => ({
  shortcutStore: { shortcuts: [] },
}));

vi.mock('../../services/extension/preferencesPromptStore.svelte', () => ({
  preferencesPromptStore: { active: null },
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

vi.mock('../../services/extension/extensionManager.svelte', () => {
  const stub = {
    getCommandArgMeta: vi.fn(() => null),
  };
  return { __esModule: true, default: stub, extensionManager: stub };
});

vi.mock('../../services/search/commandArguments', () => ({
  commandArgumentsService: {
    active: null,
    enter: vi.fn().mockResolvedValue(undefined),
    prepareRun: vi.fn().mockResolvedValue({ needsEntry: false, args: {} }),
    runWithStash: vi.fn().mockResolvedValue(false),
    submit: vi.fn().mockResolvedValue(undefined),
    exit: vi.fn(),
  },
}));

import { LauncherController } from './launcherController.svelte';
import { searchStores } from '../../services/search/stores/search.svelte';
import { searchOrchestrator } from '../../services/search/searchOrchestrator.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { contextModeService } from '../../services/context/contextModeService.svelte';
import { preferencesPromptStore } from '../../services/extension/preferencesPromptStore.svelte';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { commandArgumentsService } from '../../services/search/commandArguments';
import { extensionManager } from '../../services/extension/extensionManager.svelte';
import { scrollSelectedIntoView, resetListScroll } from '../listScroll';

describe('LauncherController.handleEnterKey — nav-stack observation guard', () => {
  let controller: LauncherController;

  beforeEach(() => {
    vi.clearAllMocks();
    searchStores.query = 'hello';
    searchStores.selectedIndex = 0;
    vi.mocked(viewManager.getNavigationStackSize).mockReturnValue(0);

    vi.mocked(commandArgumentsService).active = null;
    // clearAllMocks leaves implementations in place, so restate the "command
    // declares nothing to collect" baseline every test starts from.
    vi.mocked(extensionManager.getCommandArgMeta).mockResolvedValue(null as never);
    vi.mocked(commandArgumentsService.prepareRun).mockResolvedValue({
      needsEntry: false,
      args: {},
    } as never);
    vi.mocked(commandArgumentsService.runWithStash).mockResolvedValue(false as never);

    controller = new LauncherController();
    controller.state.localSearchValue = 'hello';
  });

  function selectItem(item: any) {
    controller.state.searchResultItemsMapped = [item];
  }

  it('retains search when execution pauses for preferences', async () => {
    const error = new Error('preferences');
    error.name = 'PreferencesRequiredError';
    selectItem({
      type: 'command',
      object_id: 'cmd_test',
      action: vi.fn().mockRejectedValue(error),
    });
    await controller.handleEnterKey();
    expect(controller.state.localSearchValue).toBe('hello');
    expect(searchStores.query).toBe('hello');
    expect(feedbackService.report).not.toHaveBeenCalled();
  });

  it('saves the typed query when a result is used', async () => {
    const record = vi.spyOn(controller.state.queryHistory, 'record').mockResolvedValue(undefined);
    const action = vi.fn().mockResolvedValue(undefined);
    selectItem({ type: 'application', object_id: 'app_notes', action });

    await controller.handleEnterKey();

    expect(action).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith('hello');
  });

  describe('while argument mode is active', () => {
    it('submits the chips rather than running the command bare', async () => {
      // Running here would ignore the canSubmit gate and drop everything the
      // user typed.
      const action = vi.fn().mockResolvedValue(undefined);
      selectItem({ type: 'command', object_id: 'cmd_demo_greet', action });
      vi.mocked(commandArgumentsService).active = {
        commandObjectId: 'cmd_demo_greet',
      } as never;

      await controller.handleEnterKey();

      expect(commandArgumentsService.submit).toHaveBeenCalled();
      expect(action).not.toHaveBeenCalled();
      expect(commandArgumentsService.enter).not.toHaveBeenCalled();
    });

    // Regression: a click on a result row runs it through here, and the search
    // bar only intercepts Enter, so the press used to hit the bail-out and do
    // nothing at all. Picking from a dropdown by mouse leaves argument mode
    // open, which is how it was reached.
    it('leaves the row it was started from and runs the one now selected', async () => {
      const action = vi.fn().mockResolvedValue(undefined);
      selectItem({ type: 'command', object_id: 'cmd_demo_other', action });
      vi.mocked(commandArgumentsService).active = {
        commandObjectId: 'cmd_demo_greet',
      } as never;

      await controller.handleEnterKey();

      expect(commandArgumentsService.exit).toHaveBeenCalled();
      expect(commandArgumentsService.submit).not.toHaveBeenCalled();
      expect(action).toHaveBeenCalled();
    });
  });

  describe('argument gating', () => {
    const META = { args: [{ name: 'input', type: 'text' }] } as never;

    function prepared(run: { needsEntry: boolean; args?: Record<string, unknown> }) {
      vi.mocked(extensionManager.getCommandArgMeta).mockResolvedValue(META);
      vi.mocked(commandArgumentsService.prepareRun).mockResolvedValue({
        args: {},
        ...run,
      } as never);
    }

    it('runs the command when nothing required is missing', async () => {
      // Raycast fires a command whose arguments are all optional; Tab is the
      // way to fill them, Enter is not asked to stop for them.
      const action = vi.fn().mockResolvedValue(undefined);
      selectItem({ type: 'command', object_id: 'cmd_demo_greet', action });
      prepared({ needsEntry: false });

      await controller.handleEnterKey();

      expect(commandArgumentsService.enter).not.toHaveBeenCalled();
      expect(action).toHaveBeenCalledWith(undefined);
    });

    it('hands the command what it declared but was never asked for', async () => {
      const action = vi.fn().mockResolvedValue(undefined);
      selectItem({ type: 'command', object_id: 'cmd_demo_greet', action });
      prepared({ needsEntry: false, args: { style: 'casual', volume: 1 } });

      await controller.handleEnterKey();

      expect(action).toHaveBeenCalledWith({ arguments: { style: 'casual', volume: 1 } });
    });

    it('runs a stashed entry through argument mode, not around it', async () => {
      // Every way of running the row goes through here, Enter and a click on
      // the row alike, so a dropdown the user picked before escaping is
      // remembered whichever one they use.
      const action = vi.fn().mockResolvedValue(undefined);
      selectItem({ type: 'command', object_id: 'cmd_demo_greet', action });
      prepared({ needsEntry: false });
      vi.mocked(commandArgumentsService.runWithStash).mockResolvedValue(true as never);

      await controller.handleEnterKey();

      expect(commandArgumentsService.runWithStash).toHaveBeenCalledWith('cmd_demo_greet');
      expect(action).not.toHaveBeenCalled();
    });

    it('runs the command normally when there is no stash to resume', async () => {
      const action = vi.fn().mockResolvedValue(undefined);
      selectItem({ type: 'command', object_id: 'cmd_demo_greet', action });
      prepared({ needsEntry: false });

      await controller.handleEnterKey();

      expect(action).toHaveBeenCalled();
    });

    it('collects arguments first when one is required and unfilled', async () => {
      const action = vi.fn().mockResolvedValue(undefined);
      selectItem({ type: 'command', object_id: 'cmd_demo_greet', action });
      prepared({ needsEntry: true });

      await controller.handleEnterKey();

      expect(commandArgumentsService.enter).toHaveBeenCalledWith('cmd_demo_greet');
      expect(action).not.toHaveBeenCalled();
    });
  });

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
    const action = vi.fn().mockImplementation(async () => {
      stackSize = 1;
    });

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

    expect(feedbackService.report).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'action_failed',
        context: { message: 'Error executing action' },
      }),
    );
    expect(searchStores.query).toBe('hello');
  });
});

describe('LauncherController.setupEffects scroll behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls scrollSelectedIntoView when selectedIndex >= 0 and listContainer is set', async () => {
    let dispose: (() => void) | undefined;
    const controller = new LauncherController();
    const listContainer = document.createElement('div');
    controller.setListContainer(listContainer);
    searchStores.selectedIndex = 0;

    dispose = $effect.root(() => {
      controller.setupEffects();
    });

    await new Promise((r) => requestAnimationFrame(r));

    expect(scrollSelectedIntoView).toHaveBeenCalledWith(listContainer, 0);
    dispose?.();
  });

  it('calls resetListScroll when selectedIndex < 0 and listContainer is set', async () => {
    let dispose: (() => void) | undefined;
    const controller = new LauncherController();
    const listContainer = document.createElement('div');
    controller.setListContainer(listContainer);
    searchStores.selectedIndex = -1;

    dispose = $effect.root(() => {
      controller.setupEffects();
    });

    await new Promise((r) => requestAnimationFrame(r));

    expect(resetListScroll).toHaveBeenCalledWith(listContainer);
    dispose?.();
  });
});

describe('LauncherController.refreshOnReveal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchStores.query = '';
    viewManager.activeView = null;
    contextModeService.activeContext = null;
    preferencesPromptStore.active = null;
  });

  it('refreshes root search silently for the active query including empty string', () => {
    const controller = new LauncherController();
    controller.state.localSearchValue = '';

    controller.refreshOnReveal();

    expect(searchOrchestrator.handleSearch).toHaveBeenCalledWith('', { silent: true });
  });

  it('refreshes with typed query when at root search', () => {
    const controller = new LauncherController();
    controller.state.localSearchValue = 'disc';

    controller.refreshOnReveal();

    expect(searchOrchestrator.handleSearch).toHaveBeenCalledWith('disc', { silent: true });
  });

  it('uses contextQuery or active context provider name when context mode is active', () => {
    contextModeService.activeContext = {
      provider: { id: 'p1', display: { name: 'Google' } },
      query: '',
    } as never;
    const controller = new LauncherController();
    controller.state.contextQuery = '';

    controller.refreshOnReveal();

    expect(searchOrchestrator.handleSearch).toHaveBeenCalledWith('Google', { silent: true });

    controller.state.contextQuery = 'rust';
    controller.refreshOnReveal();

    expect(searchOrchestrator.handleSearch).toHaveBeenCalledWith('rust', { silent: true });
  });

  it('does nothing when an extension view or preferences prompt is active', () => {
    viewManager.activeView = 'ext/View';
    const viewController = new LauncherController();
    viewController.refreshOnReveal();
    expect(searchOrchestrator.handleSearch).not.toHaveBeenCalled();

    viewManager.activeView = null;
    preferencesPromptStore.active = {
      extensionId: 'ext',
      commandId: 'cmd',
      commandObjectId: 'cmd_ext_cmd',
      missing: [],
    } as never;
    const promptController = new LauncherController();
    promptController.refreshOnReveal();
    expect(searchOrchestrator.handleSearch).not.toHaveBeenCalled();
  });
});
