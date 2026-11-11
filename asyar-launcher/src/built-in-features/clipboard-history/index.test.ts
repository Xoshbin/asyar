/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClipboardItemType } from 'asyar-sdk/contracts';
import extension from './index';
import { clipboardViewState } from './state.svelte';

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: {
    registerAction: vi.fn(),
    unregisterAction: vi.fn(),
    setExtensionForwarder: vi.fn(),
  },
}));

vi.mock('../snippets/snippetUiState.svelte', () => ({
  snippetUiState: {
    prefillExpansion: null,
  },
}));

vi.mock('../snippets/snippetViewState.svelte', () => ({
  snippetViewState: {
    startCreate: vi.fn(),
  },
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(),
}));

vi.mock('../../services/extension/viewManager.svelte', () => ({
  viewManager: {
    goBack: vi.fn(),
    navigateToView: vi.fn(),
  },
}));

vi.mock('../../services/search/stores/search.svelte', () => ({
  searchStores: {
    query: '',
    selectedIndex: 0,
    isLoading: false,
  },
}));

vi.mock('../../services/context/contextModeService.svelte', () => ({
  contextModeService: {
    activate: vi.fn(),
    updateQuery: vi.fn(),
    pinHint: vi.fn(),
  },
}));

vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: {
    report: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../../services/run/runService.svelte', () => ({ runService: {} }));

vi.mock('./state.svelte', () => ({
  clipboardViewState: {
    initializeServices: vi.fn(),
    setSearch: vi.fn(),
    setLoading: vi.fn(),
    setItems: vi.fn(),
    setError: vi.fn(),
    items: [],
    filteredItems: [],
    selectedItem: null,
    moveSelection: vi.fn(),
    moveSelectionAndExtend: vi.fn(),
    handleItemAction: vi.fn(),
    pasteMergedSelection: vi.fn().mockResolvedValue(undefined),
    clearMultiSelect: vi.fn(),
    selectedIds: [] as string[],
    deleteItem: vi.fn().mockResolvedValue(true),
    toggleFavorite: vi.fn().mockResolvedValue(true),
    pasteAsPlainText: vi.fn().mockResolvedValue(undefined),
    typeFilter: 'all',
    showRenderedHtml: false,
    setTypeFilter: vi.fn(),
    toggleHtmlView: vi.fn(),
    getTypeFilteredItems: vi.fn().mockReturnValue([]),
    getPlainText: vi.fn().mockImplementation((item) => {
      if (item.type === ClipboardItemType.Html) return 'stripped html';
      if (item.type === ClipboardItemType.Rtf) return 'stripped rtf';
      return item.content;
    }),
  },
}));

describe('ClipboardHistoryExtension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'addEventListener');
    vi.spyOn(window, 'removeEventListener');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes keydown event listener on viewDeactivated', async () => {
    // Setup context
    const mockContext = {
      getService: vi.fn().mockImplementation((name: string) => {
        if (name === 'extensions') {
          return {
            setActiveViewActionLabel: vi.fn(),
            navigateToView: vi.fn(),
          };
        }
        if (name === 'clipboard') {
          return {
            getRecentItems: vi.fn().mockResolvedValue([]),
          };
        }
        return {
          info: vi.fn(),
          debug: vi.fn(),
          error: vi.fn(),
          warn: vi.fn(),
        };
      }),
    };

    // Initialize extension
    await extension.initialize(mockContext as any);

    // Activate view
    await extension.viewActivated('some/path');
    expect(window.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));

    const handler = vi
      .mocked(window.addEventListener)
      .mock.calls.find((call) => call[0] === 'keydown')?.[1];

    // Deactivate view
    await extension.viewDeactivated('some/path');

    expect(window.removeEventListener).toHaveBeenCalledWith('keydown', handler);
  });

  it('activate() subscribes to clipboard history capture and deactivate() unsubscribes', async () => {
    const mockClipboard = {
      initialize: vi.fn().mockResolvedValue(undefined),
      subscribeCapture: vi.fn().mockResolvedValue(undefined),
      unsubscribeCapture: vi.fn().mockResolvedValue(undefined),
      getRecentItems: vi.fn().mockResolvedValue([]),
    };
    const mockContext = {
      getService: vi.fn().mockImplementation((name: string) => {
        if (name === 'clipboard') return mockClipboard;
        if (name === 'extensions')
          return { setActiveViewActionLabel: vi.fn(), navigateToView: vi.fn() };
        return { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
      }),
    };

    await extension.initialize(mockContext as any);

    await extension.activate();
    expect(mockClipboard.initialize).toHaveBeenCalledTimes(1);
    expect(mockClipboard.subscribeCapture).toHaveBeenCalledWith('clipboard-history');

    await extension.deactivate();
    expect(mockClipboard.unsubscribeCapture).toHaveBeenCalledWith('clipboard-history');
  });

  it('activate() propagates capture subscription failures', async () => {
    const failure = new Error('capture unavailable');
    const mockClipboard = {
      initialize: vi.fn().mockResolvedValue(undefined),
      subscribeCapture: vi.fn().mockRejectedValue(failure),
      getRecentItems: vi.fn().mockResolvedValue([]),
    };
    const mockContext = {
      getService: vi.fn().mockImplementation((name: string) => {
        if (name === 'clipboard') return mockClipboard;
        if (name === 'extensions')
          return { setActiveViewActionLabel: vi.fn(), navigateToView: vi.fn() };
        return { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
      }),
    };

    await extension.initialize(mockContext as any);

    await expect(extension.activate()).rejects.toBe(failure);
  });
});

describe('Keyboard shortcut: Cmd+Backspace does not delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'addEventListener');
    vi.spyOn(window, 'removeEventListener');
  });

  it('does not call deleteItem when Cmd+Backspace is pressed with a selected item', async () => {
    const mockContext = {
      getService: vi.fn().mockImplementation((name: string) => {
        if (name === 'extensions') {
          return { setActiveViewActionLabel: vi.fn(), navigateToView: vi.fn() };
        }
        if (name === 'clipboard') {
          return { getRecentItems: vi.fn().mockResolvedValue([]) };
        }
        return { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
      }),
    };

    await extension.initialize(mockContext as any);

    // Set items and selectedItem on the mock
    const mockState = await import('./state.svelte');
    (mockState.clipboardViewState as any).items = [{ id: 'test-1', content: 'hello' }];
    (mockState.clipboardViewState as any).filteredItems = [{ id: 'test-1', content: 'hello' }];
    (mockState.clipboardViewState as any).selectedItem = { id: 'test-1', content: 'hello' };

    await extension.viewActivated('some/path');

    // Get the keydown handler
    const handler = vi
      .mocked(window.addEventListener)
      .mock.calls.find((call) => call[0] === 'keydown')?.[1] as EventListener;
    expect(handler).toBeDefined();

    // Simulate Cmd+Backspace
    const event = new KeyboardEvent('keydown', { key: 'Backspace', metaKey: true, bubbles: true });
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
    Object.defineProperty(event, 'stopPropagation', { value: vi.fn() });
    handler(event);

    // Wait for async
    await new Promise((r) => setTimeout(r, 10));

    expect(mockState.clipboardViewState.deleteItem).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe('Keyboard shortcut: Cmd+Arrow extends selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'addEventListener');
    vi.spyOn(window, 'removeEventListener');
  });

  async function activateWithHandler() {
    const mockContext = {
      getService: vi.fn().mockImplementation((name: string) => {
        if (name === 'extensions') {
          return { setActiveViewActionLabel: vi.fn(), navigateToView: vi.fn() };
        }
        if (name === 'clipboard') {
          return { getRecentItems: vi.fn().mockResolvedValue([]) };
        }
        return { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
      }),
    };
    await extension.initialize(mockContext as any);

    const mockState = await import('./state.svelte');
    (mockState.clipboardViewState as any).items = [{ id: 'test-1', content: 'hello' }];
    (mockState.clipboardViewState as any).filteredItems = [{ id: 'test-1', content: 'hello' }];
    (mockState.clipboardViewState as any).selectedItem = { id: 'test-1', content: 'hello' };

    await extension.viewActivated('some/path');
    const handler = vi
      .mocked(window.addEventListener)
      .mock.calls.find((call) => call[0] === 'keydown')?.[1] as EventListener;
    expect(handler).toBeDefined();
    return { handler, mockState };
  }

  it('calls moveSelectionAndExtend("down") on Cmd+ArrowDown, not the plain moveSelection', async () => {
    const { handler, mockState } = await activateWithHandler();

    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      metaKey: true,
      bubbles: true,
    });
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
    Object.defineProperty(event, 'stopPropagation', { value: vi.fn() });
    handler(event);

    expect(mockState.clipboardViewState.moveSelectionAndExtend).toHaveBeenCalledWith('down');
    expect(mockState.clipboardViewState.moveSelection).not.toHaveBeenCalled();
  });

  it('calls moveSelectionAndExtend("up") on Ctrl+ArrowUp', async () => {
    const { handler, mockState } = await activateWithHandler();

    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', ctrlKey: true, bubbles: true });
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
    Object.defineProperty(event, 'stopPropagation', { value: vi.fn() });
    handler(event);

    expect(mockState.clipboardViewState.moveSelectionAndExtend).toHaveBeenCalledWith('up');
  });

  it('plain ArrowDown (no modifier) still calls moveSelection, not moveSelectionAndExtend', async () => {
    const { handler, mockState } = await activateWithHandler();

    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
    Object.defineProperty(event, 'stopPropagation', { value: vi.fn() });
    handler(event);

    expect(mockState.clipboardViewState.moveSelection).toHaveBeenCalledWith('down');
    expect(mockState.clipboardViewState.moveSelectionAndExtend).not.toHaveBeenCalled();
  });
});

describe('Action: clipboard-history:paste routes to merge-paste when multi-selected', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function activateAndGetPasteAction(selectedIds: string[]) {
    const mockContext = {
      getService: vi.fn().mockImplementation((name: string) => {
        if (name === 'extensions') {
          return { setActiveViewActionLabel: vi.fn(), navigateToView: vi.fn() };
        }
        if (name === 'clipboard') {
          return { getRecentItems: vi.fn().mockResolvedValue([]) };
        }
        return { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
      }),
    };
    await extension.initialize(mockContext as any);
    await extension.executeCommand('show-clipboard');

    const mockState = await import('./state.svelte');
    (mockState.clipboardViewState as any).items = [{ id: 'test-1', content: 'hello' }];
    (mockState.clipboardViewState as any).filteredItems = [{ id: 'test-1', content: 'hello' }];
    (mockState.clipboardViewState as any).selectedItem = { id: 'test-1', content: 'hello' };
    (mockState.clipboardViewState as any).selectedIds = selectedIds;

    const { actionService } = await import('../../services/action/actionService.svelte');
    const pasteAction = vi
      .mocked(actionService.registerAction)
      .mock.calls.map((c) => c[0])
      .find((a) => a.id === 'clipboard-history:paste');
    return { pasteAction, mockState };
  }

  it('calls pasteMergedSelection when 2+ items are selected', async () => {
    const { pasteAction, mockState } = await activateAndGetPasteAction(['a', 'b']);

    expect(pasteAction?.shortcut).toBe('Enter');
    await pasteAction?.execute();

    expect(mockState.clipboardViewState.pasteMergedSelection).toHaveBeenCalled();
    expect(mockState.clipboardViewState.handleItemAction).not.toHaveBeenCalled();
  });

  it('calls handleItemAction (normal paste) when only 1 item is toggled selected', async () => {
    const { pasteAction, mockState } = await activateAndGetPasteAction(['test-1']);

    await pasteAction?.execute();

    expect(mockState.clipboardViewState.handleItemAction).toHaveBeenCalledWith(
      { id: 'test-1', content: 'hello' },
      'paste',
    );
    expect(mockState.clipboardViewState.pasteMergedSelection).not.toHaveBeenCalled();
  });

  it('calls handleItemAction (normal paste) when nothing is multi-selected', async () => {
    const { pasteAction, mockState } = await activateAndGetPasteAction([]);

    await pasteAction?.execute();

    expect(mockState.clipboardViewState.handleItemAction).toHaveBeenCalled();
    expect(mockState.clipboardViewState.pasteMergedSelection).not.toHaveBeenCalled();
  });
});

describe('viewActivated clears any stale multi-selection', () => {
  it('calls clipboardViewState.clearMultiSelect() on view activation', async () => {
    const mockContext = {
      getService: vi.fn().mockImplementation((name: string) => {
        if (name === 'extensions') {
          return { setActiveViewActionLabel: vi.fn(), navigateToView: vi.fn() };
        }
        if (name === 'clipboard') {
          return { getRecentItems: vi.fn().mockResolvedValue([]) };
        }
        return { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
      }),
    };
    await extension.initialize(mockContext as any);
    await extension.viewActivated('some/path');

    const mockState = await import('./state.svelte');
    expect(mockState.clipboardViewState.clearMultiSelect).toHaveBeenCalled();
  });
});

describe('Action registration', () => {
  it('registers view actions on view activation', async () => {
    const mockContext = {
      getService: vi.fn().mockImplementation((name: string) => {
        if (name === 'extensions') {
          return { setActiveViewActionLabel: vi.fn(), navigateToView: vi.fn() };
        }
        if (name === 'clipboard') {
          return { getRecentItems: vi.fn().mockResolvedValue([]) };
        }
        return { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
      }),
    };

    await extension.initialize(mockContext as any);
    await extension.executeCommand('show-clipboard');

    const { actionService } = await import('../../services/action/actionService.svelte');
    const registerCalls = vi.mocked(actionService.registerAction).mock.calls;

    // Type-filter actions (filter-all/text/images/files) were removed once the
    // searchBarAccessory dropdown took over filter selection (Task 17). View
    // now registers: toggle HTML + open in browser + paste as plain text +
    // toggle favorite + save as snippet + ask AI about this = 6 actions.
    expect(registerCalls.length).toBeGreaterThanOrEqual(6);

    const actionIds = registerCalls.map((call) => call[0].id);
    expect(actionIds).not.toContain('clipboard-history:filter-all');
    expect(actionIds).not.toContain('clipboard-history:filter-text');
    expect(actionIds).not.toContain('clipboard-history:filter-images');
    expect(actionIds).not.toContain('clipboard-history:filter-files');
    expect(actionIds).toContain('clipboard-history:paste');
    expect(actionIds).toContain('clipboard-history:copy');
    expect(actionIds).toContain('clipboard-history:toggle-html-view');
    expect(actionIds).toContain('clipboard-history:pin');
    expect(actionIds).toContain('clipboard-history:unpin');
    expect(actionIds).toContain('clipboard-history:paste-as-plain-text');
    expect(actionIds).toContain('clipboard-history:delete');
    expect(actionIds).toContain('clipboard-history:clear-multi-selection');

    const byId = (id: string) => registerCalls.find((call) => call[0].id === id)?.[0] as any;
    expect(byId('clipboard-history:paste')?.shortcut).toBe('Enter');
    expect(byId('clipboard-history:copy')?.shortcut).toBe('Mod+Enter');
    expect(['Control+Mod+Enter', 'Mod+Shift+Enter']).toContain(
      byId('clipboard-history:paste-as-plain-text')?.shortcut,
    );
    expect(byId('clipboard-history:open-in-browser')?.shortcut).toBe('Mod+O');
    expect(byId('clipboard-history:save-as-snippet')?.shortcut).toBe('Mod+S');
    expect(byId('clipboard-history:ask-ai-about-this')?.shortcut).toBe('Mod+I');
    expect(byId('clipboard-history:delete')?.shortcut).toBe('Control+X');
    expect(byId('clipboard-history:delete')?.confirm).toBe(true);
    expect(byId('clipboard-history:delete')?.destructive).toBe(true);
    expect(byId('clipboard-history:pin')?.icon).toBe('icon:pin');
    expect(byId('clipboard-history:pin')?.shortcut).toBe('Mod+.');
    expect(byId('clipboard-history:unpin')?.icon).toBe('icon:pin');
    expect(byId('clipboard-history:unpin')?.shortcut).toBe('Mod+.');
  });

  it('registers Clear Clipboard History as an in-view destructive action', async () => {
    const clearNonFavorites = vi.fn().mockResolvedValue(undefined);
    const mockContext = {
      getService: vi.fn().mockImplementation((name: string) => {
        if (name === 'extensions') {
          return { setActiveViewActionLabel: vi.fn(), navigateToView: vi.fn() };
        }
        if (name === 'clipboard') {
          return { getRecentItems: vi.fn().mockResolvedValue([]), clearNonFavorites };
        }
        return { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
      }),
    };

    await extension.initialize(mockContext as any);
    await extension.executeCommand('show-clipboard');

    const { actionService } = await import('../../services/action/actionService.svelte');
    const action = vi
      .mocked(actionService.registerAction)
      .mock.calls.map((c) => c[0] as any)
      .find((a) => a.id === 'clipboard-history:clear-history');
    expect(action).toBeDefined();
    expect(action.destructive).toBe(true);
    expect(action.confirm).toBe(true);
    expect(action.shortcut).toBe('Control+Shift+X');

    await action.execute();
    expect(clearNonFavorites).toHaveBeenCalled();
  });

  it('clear-multi-selection action is only visible when a selection exists, and clears it on execute', async () => {
    const mockContext = {
      getService: vi.fn().mockImplementation((name: string) => {
        if (name === 'extensions') {
          return { setActiveViewActionLabel: vi.fn(), navigateToView: vi.fn() };
        }
        if (name === 'clipboard') {
          return { getRecentItems: vi.fn().mockResolvedValue([]) };
        }
        return { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
      }),
    };
    await extension.initialize(mockContext as any);
    await extension.executeCommand('show-clipboard');

    const { actionService } = await import('../../services/action/actionService.svelte');
    const clearAction = vi
      .mocked(actionService.registerAction)
      .mock.calls.find((c) => c[0].id === 'clipboard-history:clear-multi-selection')?.[0];
    expect(clearAction).toBeDefined();

    const mockState = await import('./state.svelte');
    (mockState.clipboardViewState as any).selectedIds = [];
    expect((clearAction as any).visible?.()).toBe(false);

    (mockState.clipboardViewState as any).selectedIds = ['a', 'b'];
    expect((clearAction as any).visible?.()).toBe(true);

    await clearAction!.execute();
    expect(mockState.clipboardViewState.clearMultiSelect).toHaveBeenCalled();
  });

  it('clear-multi-selection action is unregistered on view deactivation', async () => {
    const mockContext = {
      getService: vi.fn().mockImplementation((name: string) => {
        if (name === 'extensions') {
          return { setActiveViewActionLabel: vi.fn(), navigateToView: vi.fn() };
        }
        if (name === 'clipboard') {
          return { getRecentItems: vi.fn().mockResolvedValue([]) };
        }
        return { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
      }),
    };
    await extension.initialize(mockContext as any);
    await extension.executeCommand('show-clipboard');
    await extension.viewDeactivated('clipboard-history/DefaultView');

    const { actionService } = await import('../../services/action/actionService.svelte');
    expect(actionService.unregisterAction).toHaveBeenCalledWith(
      'clipboard-history:clear-multi-selection',
    );
  });
});

describe('Save as Snippet action', () => {
  let mockNavigateToView: ReturnType<typeof vi.fn>;
  let mockContext: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(window, 'addEventListener');
    vi.spyOn(window, 'removeEventListener');

    const { snippetUiState } = await import('../snippets/snippetUiState.svelte');
    snippetUiState.prefillExpansion = null;

    mockNavigateToView = vi.fn();
    mockContext = {
      getService: vi.fn().mockImplementation((name: string) => {
        if (name === 'extensions') {
          return { setActiveViewActionLabel: vi.fn(), navigateToView: mockNavigateToView };
        }
        if (name === 'clipboard') {
          return { getRecentItems: vi.fn().mockResolvedValue([]) };
        }
        return { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
      }),
    };

    await extension.initialize(mockContext as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('save-as-snippet action is registered when view activates', async () => {
    await extension.executeCommand('show-clipboard');

    const { actionService } = await import('../../services/action/actionService.svelte');
    const registerCalls = vi.mocked(actionService.registerAction).mock.calls;
    const actionIds = registerCalls.map((call) => call[0].id);
    expect(actionIds).toContain('clipboard-history:save-as-snippet');
  });

  it('save-as-snippet action is unregistered when view deactivates', async () => {
    await extension.executeCommand('show-clipboard');
    await extension.viewDeactivated('clipboard-history/DefaultView');

    const { actionService } = await import('../../services/action/actionService.svelte');
    expect(actionService.unregisterAction).toHaveBeenCalledWith(
      'clipboard-history:save-as-snippet',
    );
  });

  it('execute() sets snippetUiState.prefillExpansion to the selected item content', async () => {
    await extension.executeCommand('show-clipboard');

    const mockState = await import('./state.svelte');
    (mockState.clipboardViewState as any).selectedItem = {
      id: 'test-1',
      type: ClipboardItemType.Text,
      content: 'Hello from clipboard',
      createdAt: Date.now(),
      favorite: false,
    };

    const { actionService } = await import('../../services/action/actionService.svelte');
    const registerCalls = vi.mocked(actionService.registerAction).mock.calls;
    const saveAction = registerCalls.find(
      (c) => c[0].id === 'clipboard-history:save-as-snippet',
    )?.[0];
    expect(saveAction).toBeDefined();

    await saveAction!.execute();

    const { snippetUiState } = await import('../snippets/snippetUiState.svelte');
    expect(snippetUiState.prefillExpansion).toBe('Hello from clipboard');
  });

  it('execute() starts snippet create mode', async () => {
    await extension.executeCommand('show-clipboard');

    const mockState = await import('./state.svelte');
    (mockState.clipboardViewState as any).selectedItem = {
      id: 'test-1',
      type: ClipboardItemType.Text,
      content: 'some text',
      createdAt: Date.now(),
      favorite: false,
    };

    const { actionService } = await import('../../services/action/actionService.svelte');
    const saveAction = vi
      .mocked(actionService.registerAction)
      .mock.calls.find((c) => c[0].id === 'clipboard-history:save-as-snippet')?.[0];

    await saveAction!.execute();

    const { snippetViewState } = await import('../snippets/snippetViewState.svelte');
    expect(snippetViewState.startCreate).toHaveBeenCalled();
  });

  it('execute() calls viewManager.navigateToView with snippets/SnippetFormView (searchable: false)', async () => {
    await extension.executeCommand('show-clipboard');

    const mockState = await import('./state.svelte');
    (mockState.clipboardViewState as any).selectedItem = {
      id: 'test-1',
      type: ClipboardItemType.Text,
      content: 'some text',
      createdAt: Date.now(),
      favorite: false,
    };

    const { actionService } = await import('../../services/action/actionService.svelte');
    const saveAction = vi
      .mocked(actionService.registerAction)
      .mock.calls.find((c) => c[0].id === 'clipboard-history:save-as-snippet')?.[0];

    await saveAction!.execute();

    const { viewManager } = await import('../../services/extension/viewManager.svelte');
    expect(viewManager.navigateToView).toHaveBeenCalledWith('snippets/SnippetFormView', {
      searchable: false,
    });
  });

  it('execute() does nothing if selected item type is Image', async () => {
    await extension.executeCommand('show-clipboard');
    mockNavigateToView.mockClear();

    const mockState = await import('./state.svelte');
    (mockState.clipboardViewState as any).selectedItem = {
      id: 'img-1',
      type: ClipboardItemType.Image,
      content: '/path/to/image.png',
      createdAt: Date.now(),
      favorite: false,
    };

    const { actionService } = await import('../../services/action/actionService.svelte');
    const saveAction = vi
      .mocked(actionService.registerAction)
      .mock.calls.find((c) => c[0].id === 'clipboard-history:save-as-snippet')?.[0];

    await saveAction!.execute();

    const { snippetUiState } = await import('../snippets/snippetUiState.svelte');
    expect(snippetUiState.prefillExpansion).toBe(null);
    expect(mockNavigateToView).not.toHaveBeenCalled();
  });

  it('execute() does nothing if selected item type is Files', async () => {
    await extension.executeCommand('show-clipboard');
    mockNavigateToView.mockClear();

    const mockState = await import('./state.svelte');
    (mockState.clipboardViewState as any).selectedItem = {
      id: 'files-1',
      type: ClipboardItemType.Files,
      content: '["/a.txt"]',
      createdAt: Date.now(),
      favorite: false,
    };

    const { actionService } = await import('../../services/action/actionService.svelte');
    const saveAction = vi
      .mocked(actionService.registerAction)
      .mock.calls.find((c) => c[0].id === 'clipboard-history:save-as-snippet')?.[0];

    await saveAction!.execute();

    const { snippetUiState } = await import('../snippets/snippetUiState.svelte');
    expect(snippetUiState.prefillExpansion).toBe(null);
    expect(mockNavigateToView).not.toHaveBeenCalled();
  });

  it('execute() does nothing if no item is selected', async () => {
    await extension.executeCommand('show-clipboard');
    mockNavigateToView.mockClear();

    const mockState = await import('./state.svelte');
    (mockState.clipboardViewState as any).selectedItem = null;

    const { actionService } = await import('../../services/action/actionService.svelte');
    const saveAction = vi
      .mocked(actionService.registerAction)
      .mock.calls.find((c) => c[0].id === 'clipboard-history:save-as-snippet')?.[0];

    await saveAction!.execute();

    const { snippetUiState } = await import('../snippets/snippetUiState.svelte');
    expect(snippetUiState.prefillExpansion).toBe(null);
    expect(mockNavigateToView).not.toHaveBeenCalled();
  });

  it('execute() passes HTML-stripped plain text as prefillExpansion when item type is Html', async () => {
    await extension.executeCommand('show-clipboard');

    const mockState = await import('./state.svelte');
    (mockState.clipboardViewState as any).selectedItem = {
      id: 'html-1',
      type: ClipboardItemType.Html,
      content: '<b>html content</b>',
      createdAt: Date.now(),
      favorite: false,
    };

    const { actionService } = await import('../../services/action/actionService.svelte');
    const saveAction = vi
      .mocked(actionService.registerAction)
      .mock.calls.find((c) => c[0].id === 'clipboard-history:save-as-snippet')?.[0];

    await saveAction!.execute();

    const { snippetUiState } = await import('../snippets/snippetUiState.svelte');
    expect(snippetUiState.prefillExpansion).toBe('stripped html');
    expect(mockNavigateToView).toHaveBeenCalled();
  });

  it('execute() works for Rtf type items', async () => {
    await extension.executeCommand('show-clipboard');

    const mockState = await import('./state.svelte');
    (mockState.clipboardViewState as any).selectedItem = {
      id: 'rtf-1',
      type: ClipboardItemType.Rtf,
      content: '{\\rtf content}',
      createdAt: Date.now(),
      favorite: false,
    };

    const { actionService } = await import('../../services/action/actionService.svelte');
    const saveAction = vi
      .mocked(actionService.registerAction)
      .mock.calls.find((c) => c[0].id === 'clipboard-history:save-as-snippet')?.[0];

    await saveAction!.execute();

    const { snippetUiState } = await import('../snippets/snippetUiState.svelte');
    expect(snippetUiState.prefillExpansion).toBe('stripped rtf');
    expect(mockNavigateToView).toHaveBeenCalled();
  });
});

describe('Ask AI about this action', () => {
  let mockContext: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockContext = {
      getService: vi.fn().mockImplementation((name: string) => {
        if (name === 'extensions') {
          return {
            setActiveViewActionLabel: vi.fn(),
            navigateToView: vi.fn(),
          };
        }
        if (name === 'clipboard') {
          return { getRecentItems: vi.fn().mockResolvedValue([]) };
        }
        return { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
      }),
    };

    const { searchStores } = await import('../../services/search/stores/search.svelte');
    searchStores.query = '';

    const { contextModeService } = await import('../../services/context/contextModeService.svelte');
    const { feedbackService } = await import('../../services/feedback/feedbackService.svelte');
    const { viewManager } = await import('../../services/extension/viewManager.svelte');
    vi.mocked(contextModeService.activate).mockClear();
    vi.mocked(contextModeService.updateQuery).mockClear();
    vi.mocked(contextModeService.pinHint).mockClear();
    vi.mocked(feedbackService.report).mockClear();
    vi.mocked(viewManager.goBack).mockClear();

    await extension.initialize(mockContext as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers the action when the clipboard view activates', async () => {
    await extension.executeCommand('show-clipboard');

    const { actionService } = await import('../../services/action/actionService.svelte');
    const registerCalls = vi.mocked(actionService.registerAction).mock.calls;
    const actionIds = registerCalls.map((c) => c[0].id);
    expect(actionIds).toContain('clipboard-history:ask-ai-about-this');
  });

  it('unregisters the action when the view deactivates', async () => {
    await extension.executeCommand('show-clipboard');
    await extension.viewDeactivated('clipboard-history/DefaultView');

    const { actionService } = await import('../../services/action/actionService.svelte');
    expect(actionService.unregisterAction).toHaveBeenCalledWith(
      'clipboard-history:ask-ai-about-this',
    );
  });

  it("execute() with a Text item calls extensionManager.goBack, pinHint('ai-chat'), and sets searchStores.query; no diagnostic", async () => {
    await extension.executeCommand('show-clipboard');

    const mockState = await import('./state.svelte');
    (mockState.clipboardViewState as any).selectedItem = {
      id: 'test-1',
      type: ClipboardItemType.Text,
      content: 'hello world',
      createdAt: Date.now(),
      favorite: false,
    };

    const { actionService } = await import('../../services/action/actionService.svelte');
    const askAction = vi
      .mocked(actionService.registerAction)
      .mock.calls.find((c) => c[0].id === 'clipboard-history:ask-ai-about-this')?.[0];
    expect(askAction).toBeDefined();

    await askAction!.execute();

    const { contextModeService } = await import('../../services/context/contextModeService.svelte');
    const { feedbackService } = await import('../../services/feedback/feedbackService.svelte');
    const { searchStores } = await import('../../services/search/stores/search.svelte');
    const { viewManager } = await import('../../services/extension/viewManager.svelte');

    expect(viewManager.goBack).toHaveBeenCalled();
    expect(contextModeService.pinHint).toHaveBeenCalledWith('agents:default');
    expect(searchStores.query).toBe('hello world');
    expect(contextModeService.activate).not.toHaveBeenCalled();
    expect(contextModeService.updateQuery).not.toHaveBeenCalled();
    expect(feedbackService.report).not.toHaveBeenCalled();
  });

  it('execute() with an Html item sets searchStores.query to the HTML-stripped plain text', async () => {
    await extension.executeCommand('show-clipboard');

    const mockState = await import('./state.svelte');
    (mockState.clipboardViewState as any).selectedItem = {
      id: 'html-1',
      type: ClipboardItemType.Html,
      content: '<b>html content</b>',
      createdAt: Date.now(),
      favorite: false,
    };

    const { actionService } = await import('../../services/action/actionService.svelte');
    const askAction = vi
      .mocked(actionService.registerAction)
      .mock.calls.find((c) => c[0].id === 'clipboard-history:ask-ai-about-this')?.[0];

    await askAction!.execute();

    const { contextModeService } = await import('../../services/context/contextModeService.svelte');
    const { searchStores } = await import('../../services/search/stores/search.svelte');
    const { viewManager } = await import('../../services/extension/viewManager.svelte');

    expect(searchStores.query).toBe('stripped html');
    expect(contextModeService.pinHint).toHaveBeenCalledWith('agents:default');
    expect(viewManager.goBack).toHaveBeenCalled();
  });

  it('execute() with an Rtf item sets searchStores.query to the RTF-stripped plain text', async () => {
    await extension.executeCommand('show-clipboard');

    const mockState = await import('./state.svelte');
    (mockState.clipboardViewState as any).selectedItem = {
      id: 'rtf-1',
      type: ClipboardItemType.Rtf,
      content: '{\\rtf content}',
      createdAt: Date.now(),
      favorite: false,
    };

    const { actionService } = await import('../../services/action/actionService.svelte');
    const askAction = vi
      .mocked(actionService.registerAction)
      .mock.calls.find((c) => c[0].id === 'clipboard-history:ask-ai-about-this')?.[0];

    await askAction!.execute();

    const { contextModeService } = await import('../../services/context/contextModeService.svelte');
    const { searchStores } = await import('../../services/search/stores/search.svelte');
    const { viewManager } = await import('../../services/extension/viewManager.svelte');

    expect(searchStores.query).toBe('stripped rtf');
    expect(contextModeService.pinHint).toHaveBeenCalledWith('agents:default');
    expect(viewManager.goBack).toHaveBeenCalled();
  });

  it('execute() with an Image item shows the "Not supported yet" toast and does not call goBack, pinHint, or mutate searchStores.query', async () => {
    await extension.executeCommand('show-clipboard');

    const mockState = await import('./state.svelte');
    (mockState.clipboardViewState as any).selectedItem = {
      id: 'img-1',
      type: ClipboardItemType.Image,
      content: '/path/to/image.png',
      createdAt: Date.now(),
      favorite: false,
    };

    const { actionService } = await import('../../services/action/actionService.svelte');
    const askAction = vi
      .mocked(actionService.registerAction)
      .mock.calls.find((c) => c[0].id === 'clipboard-history:ask-ai-about-this')?.[0];

    await askAction!.execute();

    const { contextModeService } = await import('../../services/context/contextModeService.svelte');
    const { feedbackService } = await import('../../services/feedback/feedbackService.svelte');
    const { searchStores } = await import('../../services/search/stores/search.svelte');
    const { viewManager } = await import('../../services/extension/viewManager.svelte');

    expect(feedbackService.report).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'manual',
        severity: 'error',
        context: expect.objectContaining({ message: expect.stringContaining('Image') }),
      }),
    );
    expect(feedbackService.report).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ message: expect.stringContaining('Ask AI about this') }),
      }),
    );
    expect(viewManager.goBack).not.toHaveBeenCalled();
    expect(contextModeService.pinHint).not.toHaveBeenCalled();
    expect(searchStores.query).toBe('');
  });

  it('execute() with a Files item reports error diagnostic and does not call goBack, pinHint, or mutate searchStores.query', async () => {
    await extension.executeCommand('show-clipboard');

    const mockState = await import('./state.svelte');
    (mockState.clipboardViewState as any).selectedItem = {
      id: 'files-1',
      type: ClipboardItemType.Files,
      content: '["/a.txt"]',
      createdAt: Date.now(),
      favorite: false,
    };

    const { actionService } = await import('../../services/action/actionService.svelte');
    const askAction = vi
      .mocked(actionService.registerAction)
      .mock.calls.find((c) => c[0].id === 'clipboard-history:ask-ai-about-this')?.[0];

    await askAction!.execute();

    const { contextModeService } = await import('../../services/context/contextModeService.svelte');
    const { feedbackService } = await import('../../services/feedback/feedbackService.svelte');
    const { searchStores } = await import('../../services/search/stores/search.svelte');
    const { viewManager } = await import('../../services/extension/viewManager.svelte');

    expect(feedbackService.report).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'manual',
        severity: 'error',
        context: expect.objectContaining({ message: expect.stringContaining('File') }),
      }),
    );
    expect(feedbackService.report).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ message: expect.stringContaining('Ask AI about this') }),
      }),
    );
    expect(viewManager.goBack).not.toHaveBeenCalled();
    expect(contextModeService.pinHint).not.toHaveBeenCalled();
    expect(searchStores.query).toBe('');
  });

  it('execute() with no item selected does nothing — no diagnostic, no goBack, no pinHint, no query change', async () => {
    await extension.executeCommand('show-clipboard');

    const mockState = await import('./state.svelte');
    (mockState.clipboardViewState as any).selectedItem = null;

    const { actionService } = await import('../../services/action/actionService.svelte');
    const askAction = vi
      .mocked(actionService.registerAction)
      .mock.calls.find((c) => c[0].id === 'clipboard-history:ask-ai-about-this')?.[0];

    await askAction!.execute();

    const { contextModeService } = await import('../../services/context/contextModeService.svelte');
    const { feedbackService } = await import('../../services/feedback/feedbackService.svelte');
    const { searchStores } = await import('../../services/search/stores/search.svelte');
    const { viewManager } = await import('../../services/extension/viewManager.svelte');

    expect(feedbackService.report).not.toHaveBeenCalled();
    expect(viewManager.goBack).not.toHaveBeenCalled();
    expect(contextModeService.pinHint).not.toHaveBeenCalled();
    expect(searchStores.query).toBe('');
  });

  it('execute() with empty plain text does nothing', async () => {
    await extension.executeCommand('show-clipboard');

    const mockState = await import('./state.svelte');
    (mockState.clipboardViewState as any).selectedItem = {
      id: 'empty-1',
      type: ClipboardItemType.Text,
      content: '   ',
      createdAt: Date.now(),
      favorite: false,
    };

    vi.mocked(mockState.clipboardViewState.getPlainText).mockResolvedValueOnce('   ');

    const { actionService } = await import('../../services/action/actionService.svelte');
    const askAction = vi
      .mocked(actionService.registerAction)
      .mock.calls.find((c) => c[0].id === 'clipboard-history:ask-ai-about-this')?.[0];

    await askAction!.execute();

    const { contextModeService } = await import('../../services/context/contextModeService.svelte');
    const { feedbackService } = await import('../../services/feedback/feedbackService.svelte');
    const { searchStores } = await import('../../services/search/stores/search.svelte');
    const { viewManager } = await import('../../services/extension/viewManager.svelte');

    expect(feedbackService.report).not.toHaveBeenCalled();
    expect(viewManager.goBack).not.toHaveBeenCalled();
    expect(contextModeService.pinHint).not.toHaveBeenCalled();
    expect(searchStores.query).toBe('');
  });
});

it('restores clipboard actions when returning from a child view', async () => {
  const { actionService } = await import('../../services/action/actionService.svelte');
  vi.mocked(actionService.registerAction).mockClear();
  await extension.viewActivated('clipboard-history/DefaultView');
  expect(actionService.registerAction).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'clipboard-history:save-as-snippet' }),
  );
});
