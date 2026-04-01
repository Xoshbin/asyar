/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

vi.mock('./state.svelte', () => ({
  clipboardViewState: {
    initializeServices: vi.fn(),
    setSearch: vi.fn(),
    setLoading: vi.fn(),
    setItems: vi.fn(),
    setError: vi.fn(),
    items: [],
    selectedItem: null,
    moveSelection: vi.fn(),
    handleItemAction: vi.fn(),
    deleteItem: vi.fn().mockResolvedValue(true),
    typeFilter: 'all',
    setTypeFilter: vi.fn(),
    getTypeFilteredItems: vi.fn().mockReturnValue([]),
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
        if (name === "ExtensionManager") {
          return {
            setActiveViewActionLabel: vi.fn(),
            navigateToView: vi.fn(),
          };
        }
        if (name === "ClipboardHistoryService") {
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
        if (name === "ExtensionManager") {
          return { setActiveViewActionLabel: vi.fn(), navigateToView: vi.fn() };
        }
        if (name === "ClipboardHistoryService") {
          return { getRecentItems: vi.fn().mockResolvedValue([]) };
        }
        return { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
      }),
    };

    await extension.initialize(mockContext as any);
    
    // Set items and selectedItem on the mock
    const mockState = await import('./state.svelte');
    (mockState.clipboardViewState as any).items = [{ id: 'test-1', content: 'hello' }];
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
