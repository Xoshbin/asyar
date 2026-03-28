import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writable, get } from 'svelte/store';
import { createKeyboardHandlers, type KeyboardDeps } from './launcherKeyboard';

// Mocking dependencies
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../../services/extension/extensionManager', () => {
  const { writable } = require('svelte/store');
  return {
    __esModule: true,
    default: {
      goBack: vi.fn(),
      forwardKeyToActiveView: vi.fn(),
      handleViewSubmit: vi.fn(),
    },
    activeView: writable(null),
    activeViewSearchable: writable(false),
  };
});

// Import the mocked stores to manipulate them in tests
import extensionManager, { activeView, activeViewSearchable } from '../../services/extension/extensionManager';


vi.mock('../../built-in-extensions/shortcuts/shortcutStore', () => {
  const { writable } = require('svelte/store');
  return {
    shortcutStore: {},
    isCapturingShortcut: writable(false),
  };
});

vi.mock('../../services/extension/extensionIframeManager', () => {
  const { writable } = require('svelte/store');
  return {
    extensionIframeManager: {},
    extensionHasInputFocus: writable(false),
  };
});

import { extensionHasInputFocus } from '../../services/extension/extensionIframeManager';
import { isCapturingShortcut } from '../../built-in-extensions/shortcuts/shortcutStore';

vi.mock('../../services/search/stores/search', () => {
  const { writable } = require('svelte/store');
  return {
    searchQuery: writable(''),
    selectedIndex: writable(-1),
    isSearchLoading: writable(false),
  };
});

import { searchQuery, selectedIndex, isSearchLoading } from '../../services/search/stores/search';

vi.mock('../../services/context/contextModeService', () => {
  const { writable } = require('svelte/store');
  return {
    contextModeService: {
      activate: vi.fn(),
      updateQuery: vi.fn(),
      contextHint: writable(null),
    },
  };
});

import { contextModeService } from '../../services/context/contextModeService';

vi.mock('../../services/settings/settingsService', () => ({
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

import { settingsService } from '../../services/settings/settingsService';

vi.mock('../../services/extension/extensionDiscovery', () => ({
  isBuiltInExtension: vi.fn(() => false),
}));

import { isBuiltInExtension } from '../../services/extension/extensionDiscovery';

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
    activeView.set(null);
    activeViewSearchable.set(false);
    selectedIndex.set(-1);
    extensionHasInputFocus.set(false);
    isCapturingShortcut.set(false);
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
      isCapturingShortcut.set(true);
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
        activeView.set('some-ext/SomeView');
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
        selectedIndex.set(0);
        const deps = createMockDeps({ getSearchResultsLength: vi.fn(() => 5) });
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('ArrowDown');

        handleKeydown(event);

        expect(get(selectedIndex)).toBe(1);
        expect(event.preventDefault).toHaveBeenCalled();
      });

      it('ArrowUp decrements selectedIndex with wrap', () => {
        selectedIndex.set(0);
        const deps = createMockDeps({ getSearchResultsLength: vi.fn(() => 5) });
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('ArrowUp');

        handleKeydown(event);

        expect(get(selectedIndex)).toBe(4);
        expect(event.preventDefault).toHaveBeenCalled();
      });

      it('ArrowDown at last item wraps to first', () => {
        selectedIndex.set(4);
        const deps = createMockDeps({ getSearchResultsLength: vi.fn(() => 5) });
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('ArrowDown');

        handleKeydown(event);

        expect(get(selectedIndex)).toBe(0);
      });

      it('ArrowDown does nothing when no results', () => {
        selectedIndex.set(-1);
        const deps = createMockDeps({ getSearchResultsLength: vi.fn(() => 0) });
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('ArrowDown');

        handleKeydown(event);

        expect(get(selectedIndex)).toBe(-1);
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
        activeView.set('ext/View');
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
        activeView.set('ext/View');
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
        activeView.set('ext/View');
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
        activeView.set('ext/View');
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
        activeView.set('ext/View');
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
        activeView.set('ext/View');
        activeViewSearchable.set(true);
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
