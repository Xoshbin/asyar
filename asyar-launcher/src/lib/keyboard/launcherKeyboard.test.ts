import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createKeyboardHandlers, type KeyboardDeps } from './launcherKeyboard';

// Mocking dependencies
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockExtensionManager = {
  goBack: vi.fn(),
  forwardKeyToActiveView: vi.fn(),
  handleViewSubmit: vi.fn(),
};

vi.mock('../../services/extension/extensionManager.svelte', () => {
  return {
    __esModule: true,
    extensionManager: mockExtensionManager,
    default: mockExtensionManager,
  };
});

vi.mock('../../services/extension/viewManager.svelte', () => {
  return {
    viewManager: {
      activeView: null,
      activeViewSearchable: false,
      getActiveView: vi.fn(() => null),
    }
  };
});

// Import the mocked services
import { extensionManager } from '../../services/extension/extensionManager.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';

vi.mock('../../built-in-features/shortcuts/shortcutStore.svelte', () => {
  return {
    shortcutStore: {
      isCapturing: false,
      shortcuts: [],
    },
  };
});

vi.mock('../../services/extension/extensionIframeManager.svelte', () => {
  return {
    extensionIframeManager: {
      hasInputFocus: false,
    },
  };
});

import { extensionIframeManager } from '../../services/extension/extensionIframeManager.svelte';
import { shortcutStore } from '../../built-in-features/shortcuts/shortcutStore.svelte';

vi.mock('../../services/search/stores/search.svelte', () => {
  return {
    searchStores: {
      query: '',
      selectedIndex: -1,
      isLoading: false,
    },
  };
});

import { searchStores } from '../../services/search/stores/search.svelte';

vi.mock('../../services/context/contextModeService.svelte', () => {
  return {
    contextModeService: {
      activate: vi.fn(),
      updateQuery: vi.fn(),
      contextHint: null,
    },
  };
});

import { contextModeService } from '../../services/context/contextModeService.svelte';

vi.mock('../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    getSettings: vi.fn(() => ({
      general: { 
        startAtLogin: false,
        showDockIcon: true,
        escapeInViewBehavior: 'close-window' 
      },
      search: { searchApplications: true, searchSystemPreferences: true, fuzzySearch: true },
      shortcut: { modifier: 'Super', key: 'K' },
      appearance: { theme: 'system', windowWidth: 800, windowHeight: 600 },
      extensions: { enabled: {} },
      calculator: { refreshInterval: 6 }
    })),
  },
}));

import { settingsService } from '../../services/settings/settingsService.svelte';

vi.mock('../../services/extension/extensionDiscovery', () => ({
  isBuiltInFeature: vi.fn(() => false),
}));

import { isBuiltInFeature } from '../../services/extension/extensionDiscovery';

vi.mock('../../services/log/logService', () => ({
  logService: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { invoke } from '@tauri-apps/api/core';

// Mock Browser Globals for Node environment
if (typeof global.document === 'undefined') {
  const _doc = {
    _activeElement: null as any,
    get activeElement() { return this._activeElement; },
    set activeElement(el: any) { this._activeElement = el; }
  };
  (global as any).document = _doc;
}

if (typeof global.KeyboardEvent === 'undefined') {
  (global as any).KeyboardEvent = class KeyboardEvent {
    constructor(public type: string, public init?: any) {
      Object.assign(this, init);
    }
    preventDefault = () => {};
    stopPropagation = () => {};
  };
}

if (typeof global.requestAnimationFrame === 'undefined') {
  (global as any).requestAnimationFrame = (callback: any) => setTimeout(callback, 0);
}

// Helper to create a mock KeyboardEvent:
function createKeyEvent(key: string, opts: Partial<KeyboardEvent> = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }) as KeyboardEvent;
  // Spy on preventDefault and stopPropagation
  event.preventDefault = vi.fn();
  event.stopPropagation = vi.fn();
  return event;
}

// Helper to create mock deps:
function createMockDeps(overrides: Partial<KeyboardDeps> = {}): KeyboardDeps {
  const bottomBar = { 
    isOpen: vi.fn(() => false), 
    closeActionList: vi.fn(), 
    toggleActionList: vi.fn() 
  };
  const searchInput = { focus: vi.fn(), value: '' };
  return {
    getSearchInput: vi.fn(() => searchInput as any),
    getLocalSearchValue: vi.fn(() => ''),
    setLocalSearchValue: vi.fn(),
    getContextQuery: vi.fn(() => ''),
    setContextQuery: vi.fn(),
    getContextHint: vi.fn(() => null),
    getActiveContext: vi.fn(() => null),
    getSearchResultsLength: vi.fn(() => 5),
    getBottomBar: vi.fn(() => bottomBar),
    handleEnterKey: vi.fn(async () => {}),
    handleContextDismiss: vi.fn(),
    onBeforeHide: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('launcherKeyboard characterization tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewManager.activeView = null;
    viewManager.activeViewSearchable = false;
    searchStores.selectedIndex = -1;
    extensionIframeManager.hasInputFocus = false;
    shortcutStore.isCapturing = false;
    vi.mocked(settingsService.getSettings).mockReturnValue({
      general: { 
        startAtLogin: false,
        showDockIcon: true,
        escapeInViewBehavior: 'close-window',
      },
      search: { searchApplications: true, searchSystemPreferences: true, fuzzySearch: true },
      shortcut: { modifier: 'Super', key: 'K' },
      appearance: { theme: 'system', windowWidth: 800, windowHeight: 600 },
      extensions: { enabled: {} },
      calculator: { refreshInterval: 6 },
    } as any);
    (document as any).activeElement = null;
  });

  describe('handleGlobalKeydown', () => {
    it('does nothing when isCapturingShortcut is true', () => {
      shortcutStore.isCapturing = true;
      const deps = createMockDeps();
      const { handleGlobalKeydown } = createKeyboardHandlers(deps);
      const event = createKeyEvent('Enter');

      handleGlobalKeydown(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(deps.handleEnterKey).not.toHaveBeenCalled();
    });

    describe('Tab / Context Hint Commit', () => {
      it('Tab commits context hint into full context mode', () => {
        const hint = {
          type: 'prefix',
          provider: { id: 'portals', type: 'url', display: { name: 'Portals', icon: '🔗' }, triggers: ['portals'] }
        } as any;
        const deps = createMockDeps({
          getContextHint: vi.fn(() => hint),
          getActiveContext: vi.fn(() => null),
        });
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Tab');

        handleGlobalKeydown(event);

        expect(contextModeService.activate).toHaveBeenCalledWith('portals', '');
        expect(deps.setLocalSearchValue).toHaveBeenCalledWith('');
        expect(event.preventDefault).toHaveBeenCalled();
      });

      it('Tab with AI hint passes current query to context activation', () => {
        const hint = {
          type: 'ai',
          provider: { id: 'ai-chat', type: 'stream', display: { name: 'Chat', icon: '🤖' }, triggers: [] }
        } as any;
        const deps = createMockDeps({
          getContextHint: vi.fn(() => hint),
          getActiveContext: vi.fn(() => null),
          getLocalSearchValue: vi.fn(() => 'what is rust'),
        });
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Tab');

        handleGlobalKeydown(event);

        expect(contextModeService.activate).toHaveBeenCalledWith('ai-chat', 'what is rust');
        expect(event.preventDefault).toHaveBeenCalled();
      });

      it('Tab does nothing when no context hint', () => {
        const deps = createMockDeps({
          getContextHint: vi.fn(() => null),
        });
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Tab');

        handleGlobalKeydown(event);

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(contextModeService.activate).not.toHaveBeenCalled();
      });

      it('Tab does nothing when already in context mode', () => {
        const hint = { provider: { id: 'test' } } as any;
        const deps = createMockDeps({
          getContextHint: vi.fn(() => hint),
          getActiveContext: vi.fn(() => ({ provider: { id: 'existing' }, query: '' } as any)),
        });
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Tab');

        handleGlobalKeydown(event);

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(contextModeService.activate).not.toHaveBeenCalled();
      });
    });

    describe('Backspace / Context Exit', () => {
      it('Backspace exits context mode when context query is empty', () => {
        const deps = createMockDeps({
          getActiveContext: vi.fn(() => ({ provider: { id: 'google' }, query: '' } as any)),
        });
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Backspace');

        handleGlobalKeydown(event);

        expect(deps.handleContextDismiss).toHaveBeenCalledWith(false);
        expect(event.preventDefault).toHaveBeenCalled();
      });

      it('Backspace exits context AND goes back when in view with empty query', () => {
        viewManager.activeView = 'some-ext/SomeView';
        const deps = createMockDeps({
          getActiveContext: vi.fn(() => ({ provider: { id: 'google' }, query: '' } as any)),
        });
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Backspace');

        handleGlobalKeydown(event);

        expect(deps.handleContextDismiss).toHaveBeenCalledWith(true);
        expect(extensionManager.goBack).toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();
      });

      it('Backspace does NOT exit context when query is non-empty', () => {
        const deps = createMockDeps({
          getActiveContext: vi.fn(() => ({ provider: { id: 'google' }, query: 'hello' } as any)),
        });
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Backspace');

        handleGlobalKeydown(event);

        expect(deps.handleContextDismiss).not.toHaveBeenCalled();
        expect(event.preventDefault).not.toHaveBeenCalled();
      });
    });

    describe('Cmd/Ctrl+K Action Panel', () => {
      it('Cmd+K toggles action panel', () => {
        const deps = createMockDeps();
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('k', { metaKey: true });

        handleGlobalKeydown(event);

        expect(deps.getBottomBar()?.toggleActionList).toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();
        expect(event.stopPropagation).toHaveBeenCalled();
      });

      it('Ctrl+K toggles action panel', () => {
        const deps = createMockDeps();
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('k', { ctrlKey: true });

        handleGlobalKeydown(event);

        expect(deps.getBottomBar()?.toggleActionList).toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();
        expect(event.stopPropagation).toHaveBeenCalled();
      });
    });

    describe('Close Action Panel', () => {
      it('Escape closes action panel when open', () => {
        const bottomBar = { isOpen: vi.fn(() => true), closeActionList: vi.fn(), toggleActionList: vi.fn() };
        const deps = createMockDeps({
          getBottomBar: vi.fn(() => bottomBar),
        });
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Escape');

        handleGlobalKeydown(event);

        expect(bottomBar.closeActionList).toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();
      });

      it('Backspace closes action panel when open', () => {
        const bottomBar = { isOpen: vi.fn(() => true), closeActionList: vi.fn(), toggleActionList: vi.fn() };
        const deps = createMockDeps({
          getBottomBar: vi.fn(() => bottomBar),
        });
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Backspace');

        handleGlobalKeydown(event);

        expect(bottomBar.closeActionList).toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();
      });
    });
  });

  describe('handleKeydown', () => {
    describe('Search Navigation (no active view)', () => {
      it('ArrowDown increments selectedIndex with wrap', () => {
        searchStores.selectedIndex = 0;
        const deps = createMockDeps({ getSearchResultsLength: vi.fn(() => 5) });
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('ArrowDown');

        handleKeydown(event);

        expect(searchStores.selectedIndex).toBe(1);
        expect(event.preventDefault).toHaveBeenCalled();
      });

      it('ArrowUp decrements selectedIndex with wrap', () => {
        searchStores.selectedIndex = 0;
        const deps = createMockDeps({ getSearchResultsLength: vi.fn(() => 5) });
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('ArrowUp');

        handleKeydown(event);

        expect(searchStores.selectedIndex).toBe(4);
        expect(event.preventDefault).toHaveBeenCalled();
      });

      it('ArrowDown at last item wraps to first', () => {
        searchStores.selectedIndex = 4;
        const deps = createMockDeps({ getSearchResultsLength: vi.fn(() => 5) });
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('ArrowDown');

        handleKeydown(event);

        expect(searchStores.selectedIndex).toBe(0);
      });

      it('ArrowDown does nothing when no results', () => {
        searchStores.selectedIndex = -1;
        const deps = createMockDeps({ getSearchResultsLength: vi.fn(() => 0) });
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('ArrowDown');

        handleKeydown(event);

        expect(searchStores.selectedIndex).toBe(-1);
      });

      it('Enter calls handleEnterKey when no active context', () => {
        const deps = createMockDeps({
          getActiveContext: vi.fn(() => null),
        });
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Enter');

        handleKeydown(event);

        expect(deps.handleEnterKey).toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();
      });

      it('Enter submits context query when context active with non-empty query', () => {
        const deps = createMockDeps({
          getActiveContext: vi.fn(() => ({ provider: { id: 'google' }, query: 'rust lang' } as any)),
        });
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Enter');

        handleKeydown(event);

        expect(contextModeService.activate).toHaveBeenCalledWith('google', 'rust lang');
        expect(deps.handleEnterKey).not.toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();
      });
    });

    describe('Escape behavior', () => {
      it('Escape hides launcher when no active view', async () => {
        const deps = createMockDeps();
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Escape');

        handleKeydown(event);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(invoke).toHaveBeenCalledWith('hide');
        expect(event.preventDefault).toHaveBeenCalled();
      });

      it('Escape in view goes back when escapeInViewBehavior is "go-back"', () => {
        viewManager.activeView = 'ext/View';
        vi.mocked(settingsService.getSettings).mockReturnValue({
          general: { 
            startAtLogin: false,
            showDockIcon: true,
            escapeInViewBehavior: 'go-back' 
          },
          search: { searchApplications: true, searchSystemPreferences: true, fuzzySearch: true },
          shortcut: { modifier: 'Super', key: 'K' },
          appearance: { theme: 'system', windowWidth: 800, windowHeight: 600 },
          extensions: { enabled: {} },
          calculator: { refreshInterval: 6 }
        } as any);
        const deps = createMockDeps();
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Escape');

        handleKeydown(event);

        expect(extensionManager.goBack).toHaveBeenCalled();
        expect(invoke).not.toHaveBeenCalledWith('hide');
        expect(event.preventDefault).toHaveBeenCalled();
      });

      it('Escape in view hides when escapeInViewBehavior is "close-window" (default)', async () => {
        viewManager.activeView = 'ext/View';
        vi.mocked(settingsService.getSettings).mockReturnValue({
          general: { 
            startAtLogin: false,
            showDockIcon: true,
            escapeInViewBehavior: 'close-window' 
          },
          search: { searchApplications: true, searchSystemPreferences: true, fuzzySearch: true },
          shortcut: { modifier: 'Super', key: 'K' },
          appearance: { theme: 'system', windowWidth: 800, windowHeight: 600 },
          extensions: { enabled: {} },
          calculator: { refreshInterval: 6 }
        } as any);
        const deps = createMockDeps();
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Escape');

        handleKeydown(event);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(invoke).toHaveBeenCalledWith('hide');
        expect(event.preventDefault).toHaveBeenCalled();
      });
    });

    describe('Backspace/Delete in view', () => {
      it('Backspace with empty input in view goes back', () => {
        viewManager.activeView = 'ext/View';
        const deps = createMockDeps({
          getSearchInput: vi.fn(() => ({ value: '', focus: vi.fn() } as any)),
        });
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Backspace');

        handleKeydown(event);

        expect(extensionManager.goBack).toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();
      });

      it('Backspace with non-empty input in view does NOT go back', () => {
        viewManager.activeView = 'ext/View';
        const deps = createMockDeps({
          getSearchInput: vi.fn(() => ({ value: 'hello', focus: vi.fn() } as any)),
        });
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Backspace');

        handleKeydown(event);

        expect(extensionManager.goBack).not.toHaveBeenCalled();
        expect(event.preventDefault).not.toHaveBeenCalled();
      });
    });

    describe('Enter in active view', () => {
      it('Enter in view with context submits context query', () => {
        viewManager.activeView = 'ext/View';
        const deps = createMockDeps({
          getActiveContext: vi.fn(() => ({ provider: { id: 'test' }, query: 'search term' } as any)),
          getContextQuery: vi.fn(() => 'search term'),
        });
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Enter');

        handleKeydown(event);

        expect(extensionManager.handleViewSubmit).toHaveBeenCalledWith('search term');
        expect(event.preventDefault).toHaveBeenCalled();
      });

      it('Enter in searchable view submits search value', () => {
        viewManager.activeView = 'ext/View';
        viewManager.activeViewSearchable = true;
        const deps = createMockDeps({
          getActiveContext: vi.fn(() => null),
          getLocalSearchValue: vi.fn(() => 'query'),
        });
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Enter');

        handleKeydown(event);

        expect(extensionManager.handleViewSubmit).toHaveBeenCalledWith('query');
        expect(deps.setLocalSearchValue).toHaveBeenCalledWith('');
        expect(event.preventDefault).toHaveBeenCalled();
      });
    });

  });
});
