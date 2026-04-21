/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ClipboardItemType } from 'asyar-sdk/contracts'
import extension from './index'
import { clipboardViewState } from './state.svelte'

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: { 
    registerAction: vi.fn(), 
    unregisterAction: vi.fn(),
    setExtensionForwarder: vi.fn()
  },
}))

vi.mock('../snippets/snippetUiState.svelte', () => ({
  snippetUiState: {
    prefillExpansion: null,
    editorTrigger: null,
  },
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(),
}))

vi.mock('../../services/extension/viewManager.svelte', () => ({
  viewManager: {
    goBack: vi.fn(),
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
    showToast: vi.fn().mockResolvedValue('toast-1'),
  },
}));

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
    handleItemAction: vi.fn(),
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
  }
}))

describe('ClipboardHistoryExtension', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'addEventListener')
    vi.spyOn(window, 'removeEventListener')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('removes keydown event listener on viewDeactivated', async () => {
    // Setup context
    const mockContext = {
      getService: vi.fn().mockImplementation((name: string) => {
        if (name === "extensions") {
          return {
            setActiveViewActionLabel: vi.fn(),
            navigateToView: vi.fn(),
          };
        }
        if (name === "clipboard") {
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
    await extension.initialize(mockContext as any)

    // Activate view
    await extension.viewActivated('some/path')
    expect(window.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function))

    const handler = vi.mocked(window.addEventListener).mock.calls.find(call => call[0] === 'keydown')?.[1];

    // Deactivate view
    await extension.viewDeactivated('some/path')

    // This should fail (RED) because viewDeactivated doesn't call removeEventListener currently
    expect(window.removeEventListener).toHaveBeenCalledWith('keydown', handler)
  })
})

describe('Keyboard shortcut: Cmd+Backspace to delete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'addEventListener')
    vi.spyOn(window, 'removeEventListener')
  })

  it('calls deleteItem when Cmd+Backspace is pressed with a selected item', async () => {
    const mockContext = {
      getService: vi.fn().mockImplementation((name: string) => {
        if (name === "extensions") {
          return { setActiveViewActionLabel: vi.fn(), navigateToView: vi.fn() };
        }
        if (name === "clipboard") {
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
    const handler = vi.mocked(window.addEventListener).mock.calls.find(call => call[0] === 'keydown')?.[1] as EventListener;
    expect(handler).toBeDefined();

    // Simulate Cmd+Backspace
    const event = new KeyboardEvent('keydown', { key: 'Backspace', metaKey: true, bubbles: true });
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
    Object.defineProperty(event, 'stopPropagation', { value: vi.fn() });
    handler(event);

    // Wait for async
    await new Promise(r => setTimeout(r, 10));

    expect(mockState.clipboardViewState.deleteItem).toHaveBeenCalledWith('test-1');
  });
});

describe('Action registration', () => {
  it('registers filter and toggle actions on view activation', async () => {
    const mockContext = {
      getService: vi.fn().mockImplementation((name: string) => {
        if (name === "extensions") {
          return { setActiveViewActionLabel: vi.fn(), navigateToView: vi.fn() };
        }
        if (name === "clipboard") {
          return { getRecentItems: vi.fn().mockResolvedValue([]) };
        }
        return { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
      }),
    };

    await extension.initialize(mockContext as any);
    await extension.executeCommand('show-clipboard');

    const { actionService } = await import('../../services/action/actionService.svelte');
    const registerCalls = vi.mocked(actionService.registerAction).mock.calls;
    
    // Should register: clear history + 4 filters + toggle HTML + toggle favorite + paste as plain text = 8 actions
    expect(registerCalls.length).toBeGreaterThanOrEqual(8);

    const actionIds = registerCalls.map(call => call[0].id);
    expect(actionIds).toContain('clipboard-history:filter-all');
    expect(actionIds).toContain('clipboard-history:filter-text');
    expect(actionIds).toContain('clipboard-history:filter-images');
    expect(actionIds).toContain('clipboard-history:filter-files');
    expect(actionIds).toContain('clipboard-history:toggle-html-view');
    expect(actionIds).toContain('clipboard-history:toggle-favorite');
    expect(actionIds).toContain('clipboard-history:paste-as-plain-text');
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
    snippetUiState.editorTrigger = null;

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
    const actionIds = registerCalls.map(call => call[0].id);
    expect(actionIds).toContain('clipboard-history:save-as-snippet');
  });

  it('save-as-snippet action is unregistered when view deactivates', async () => {
    await extension.executeCommand('show-clipboard');
    await extension.viewDeactivated('clipboard-history/DefaultView');

    const { actionService } = await import('../../services/action/actionService.svelte');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('clipboard-history:save-as-snippet');
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
    const saveAction = registerCalls.find(c => c[0].id === 'clipboard-history:save-as-snippet')?.[0];
    expect(saveAction).toBeDefined();

    await saveAction!.execute();

    const { snippetUiState } = await import('../snippets/snippetUiState.svelte');
    expect(snippetUiState.prefillExpansion).toBe('Hello from clipboard');
  });

  it('execute() sets snippetUiState.editorTrigger to add', async () => {
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
    const saveAction = vi.mocked(actionService.registerAction).mock.calls
      .find(c => c[0].id === 'clipboard-history:save-as-snippet')?.[0];

    await saveAction!.execute();

    const { snippetUiState } = await import('../snippets/snippetUiState.svelte');
    expect(snippetUiState.editorTrigger).toBe('add');
  });

  it('execute() calls navigateToView with snippets/DefaultView', async () => {
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
    const saveAction = vi.mocked(actionService.registerAction).mock.calls
      .find(c => c[0].id === 'clipboard-history:save-as-snippet')?.[0];

    await saveAction!.execute();

    expect(mockNavigateToView).toHaveBeenCalledWith('snippets/DefaultView');
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
    const saveAction = vi.mocked(actionService.registerAction).mock.calls
      .find(c => c[0].id === 'clipboard-history:save-as-snippet')?.[0];

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
    const saveAction = vi.mocked(actionService.registerAction).mock.calls
      .find(c => c[0].id === 'clipboard-history:save-as-snippet')?.[0];

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
    const saveAction = vi.mocked(actionService.registerAction).mock.calls
      .find(c => c[0].id === 'clipboard-history:save-as-snippet')?.[0];

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
    const saveAction = vi.mocked(actionService.registerAction).mock.calls
      .find(c => c[0].id === 'clipboard-history:save-as-snippet')?.[0];

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
    const saveAction = vi.mocked(actionService.registerAction).mock.calls
      .find(c => c[0].id === 'clipboard-history:save-as-snippet')?.[0];

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
    vi.mocked(feedbackService.showToast).mockClear();
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
    const actionIds = registerCalls.map(c => c[0].id);
    expect(actionIds).toContain('clipboard-history:ask-ai-about-this');
  });

  it('unregisters the action when the view deactivates', async () => {
    await extension.executeCommand('show-clipboard');
    await extension.viewDeactivated('clipboard-history/DefaultView');

    const { actionService } = await import('../../services/action/actionService.svelte');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('clipboard-history:ask-ai-about-this');
  });

  it('execute() with a Text item calls extensionManager.goBack, pinHint(\'ai-chat\'), and sets searchStores.query; no toast', async () => {
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
    const askAction = vi.mocked(actionService.registerAction).mock.calls
      .find(c => c[0].id === 'clipboard-history:ask-ai-about-this')?.[0];
    expect(askAction).toBeDefined();
    
    await askAction!.execute();

    const { contextModeService } = await import('../../services/context/contextModeService.svelte');
    const { feedbackService } = await import('../../services/feedback/feedbackService.svelte');
    const { searchStores } = await import('../../services/search/stores/search.svelte');
    const { viewManager } = await import('../../services/extension/viewManager.svelte');

    expect(viewManager.goBack).toHaveBeenCalled();
    expect(contextModeService.pinHint).toHaveBeenCalledWith('ai-chat');
    expect(searchStores.query).toBe('hello world');
    expect(contextModeService.activate).not.toHaveBeenCalled();
    expect(contextModeService.updateQuery).not.toHaveBeenCalled();
    expect(feedbackService.showToast).not.toHaveBeenCalled();
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
    const askAction = vi.mocked(actionService.registerAction).mock.calls
      .find(c => c[0].id === 'clipboard-history:ask-ai-about-this')?.[0];

    await askAction!.execute();

    const { contextModeService } = await import('../../services/context/contextModeService.svelte');
    const { searchStores } = await import('../../services/search/stores/search.svelte');
    const { viewManager } = await import('../../services/extension/viewManager.svelte');

    expect(searchStores.query).toBe('stripped html');
    expect(contextModeService.pinHint).toHaveBeenCalledWith('ai-chat');
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
    const askAction = vi.mocked(actionService.registerAction).mock.calls
      .find(c => c[0].id === 'clipboard-history:ask-ai-about-this')?.[0];

    await askAction!.execute();

    const { contextModeService } = await import('../../services/context/contextModeService.svelte');
    const { searchStores } = await import('../../services/search/stores/search.svelte');
    const { viewManager } = await import('../../services/extension/viewManager.svelte');

    expect(searchStores.query).toBe('stripped rtf');
    expect(contextModeService.pinHint).toHaveBeenCalledWith('ai-chat');
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
    const askAction = vi.mocked(actionService.registerAction).mock.calls
      .find(c => c[0].id === 'clipboard-history:ask-ai-about-this')?.[0];

    await askAction!.execute();

    const { contextModeService } = await import('../../services/context/contextModeService.svelte');
    const { feedbackService } = await import('../../services/feedback/feedbackService.svelte');
    const { searchStores } = await import('../../services/search/stores/search.svelte');
    const { viewManager } = await import('../../services/extension/viewManager.svelte');

    expect(feedbackService.showToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Not supported yet',
      style: 'failure',
      message: expect.stringContaining('Image'),
    }));
    expect(feedbackService.showToast).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Ask AI about this'),
    }));
    expect(viewManager.goBack).not.toHaveBeenCalled();
    expect(contextModeService.pinHint).not.toHaveBeenCalled();
    expect(searchStores.query).toBe('');
  });

  it('execute() with a Files item shows the "Not supported yet" toast and does not call goBack, pinHint, or mutate searchStores.query', async () => {
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
    const askAction = vi.mocked(actionService.registerAction).mock.calls
      .find(c => c[0].id === 'clipboard-history:ask-ai-about-this')?.[0];

    await askAction!.execute();

    const { contextModeService } = await import('../../services/context/contextModeService.svelte');
    const { feedbackService } = await import('../../services/feedback/feedbackService.svelte');
    const { searchStores } = await import('../../services/search/stores/search.svelte');
    const { viewManager } = await import('../../services/extension/viewManager.svelte');

    expect(feedbackService.showToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Not supported yet',
      style: 'failure',
      message: expect.stringContaining('File'),
    }));
    expect(feedbackService.showToast).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Ask AI about this'),
    }));
    expect(viewManager.goBack).not.toHaveBeenCalled();
    expect(contextModeService.pinHint).not.toHaveBeenCalled();
    expect(searchStores.query).toBe('');
  });

  it('execute() with no item selected does nothing — no toast, no goBack, no pinHint, no query change', async () => {
    await extension.executeCommand('show-clipboard');

    const mockState = await import('./state.svelte');
    (mockState.clipboardViewState as any).selectedItem = null;

    const { actionService } = await import('../../services/action/actionService.svelte');
    const askAction = vi.mocked(actionService.registerAction).mock.calls
      .find(c => c[0].id === 'clipboard-history:ask-ai-about-this')?.[0];

    await askAction!.execute();

    const { contextModeService } = await import('../../services/context/contextModeService.svelte');
    const { feedbackService } = await import('../../services/feedback/feedbackService.svelte');
    const { searchStores } = await import('../../services/search/stores/search.svelte');
    const { viewManager } = await import('../../services/extension/viewManager.svelte');

    expect(feedbackService.showToast).not.toHaveBeenCalled();
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

    vi.mocked(mockState.clipboardViewState.getPlainText).mockImplementationOnce(() => '   ');

    const { actionService } = await import('../../services/action/actionService.svelte');
    const askAction = vi.mocked(actionService.registerAction).mock.calls
      .find(c => c[0].id === 'clipboard-history:ask-ai-about-this')?.[0];

    await askAction!.execute();

    const { contextModeService } = await import('../../services/context/contextModeService.svelte');
    const { feedbackService } = await import('../../services/feedback/feedbackService.svelte');
    const { searchStores } = await import('../../services/search/stores/search.svelte');
    const { viewManager } = await import('../../services/extension/viewManager.svelte');

    expect(feedbackService.showToast).not.toHaveBeenCalled();
    expect(viewManager.goBack).not.toHaveBeenCalled();
    expect(contextModeService.pinHint).not.toHaveBeenCalled();
    expect(searchStores.query).toBe('');
  });
});
