import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createKeyboardHandlers, type KeyboardDeps } from './launcherKeyboard';

// Mocking dependencies
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockExtensionManager = vi.hoisted(() => ({
  goBack: vi.fn(),
  forwardKeyToActiveView: vi.fn(),
  handleViewSubmit: vi.fn(),
}));

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
      activeViewPrimaryActionLabel: null,
      getActiveView: vi.fn(() => null),
      getNavigationStackSize: vi.fn(() => 0),
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
      shortcut: { modifier: 'Alt', key: 'Space' },
      appearance: { theme: 'system', launchView: 'default', windowWidth: 800, windowHeight: 600 },
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

import { logService } from '../../services/log/logService';

vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: {
    activeDialog: null,
  },
}));

import { feedbackService } from '../../services/feedback/feedbackService.svelte';

vi.mock('../../lib/ipc/commands', () => ({
  showSettingsWindow: vi.fn(),
  hideWindow: vi.fn(),
}));

import { showSettingsWindow, hideWindow } from '../../lib/ipc/commands';
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
    viewManager.activeViewPrimaryActionLabel = null;
    searchStores.selectedIndex = -1;
    extensionIframeManager.hasInputFocus = false;
    shortcutStore.isCapturing = false;
    (feedbackService as any).activeDialog = null;
    vi.mocked(settingsService.getSettings).mockReturnValue({
      general: { 
        startAtLogin: false,
        showDockIcon: true,
        escapeInViewBehavior: 'close-window',
      },
      search: { searchApplications: true, searchSystemPreferences: true, fuzzySearch: true },
      shortcut: { modifier: 'Alt', key: 'Space' },
      appearance: { theme: 'system', launchView: 'default', windowWidth: 800, windowHeight: 600 },
      extensions: { enabled: {} },
      calculator: { refreshInterval: 6 },
    } as any);
    (document as any).activeElement = null;
  });

  describe('handleGlobalKeydown', () => {
    it('suppresses events when isCapturingShortcut is true', () => {
      shortcutStore.isCapturing = true;
      const deps = createMockDeps();
      const { handleGlobalKeydown } = createKeyboardHandlers(deps);
      const event = createKeyEvent('Enter');

      handleGlobalKeydown(event);

      expect(event.stopPropagation).toHaveBeenCalled();
      expect(event.preventDefault).toHaveBeenCalled();
      expect(deps.handleEnterKey).not.toHaveBeenCalled();
    });

    describe('Cmd/Ctrl+Q Block Quit', () => {
      it('Cmd+Q is blocked', () => {
        const deps = createMockDeps();
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('q', { metaKey: true });

        handleGlobalKeydown(event);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(event.stopPropagation).toHaveBeenCalled();
      });

      it('Ctrl+Q is blocked', () => {
        const deps = createMockDeps();
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('q', { ctrlKey: true });

        handleGlobalKeydown(event);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(event.stopPropagation).toHaveBeenCalled();
      });

      it('plain Q is not blocked', () => {
        const deps = createMockDeps();
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('q');

        handleGlobalKeydown(event);

        expect(event.stopPropagation).not.toHaveBeenCalled();
      });
    });

    describe('Dialog active guard', () => {
      it('blocks all keys when a dialog is active', () => {
        (feedbackService as any).activeDialog = { title: 'Quit' };
        const deps = createMockDeps();
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);

        for (const key of ['ArrowDown', 'Tab', 'a', 'Enter']) {
          const event = createKeyEvent(key);
          handleGlobalKeydown(event);
          expect(event.preventDefault).toHaveBeenCalled();
          expect(event.stopPropagation).toHaveBeenCalled();
        }
      });

      it('does not block keys when no dialog is active', () => {
        const deps = createMockDeps();
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('ArrowDown');

        handleGlobalKeydown(event);

        expect(event.stopPropagation).not.toHaveBeenCalled();
      });
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

      it('Cmd+K is swallowed in compact idle mode', () => {
        const deps = createMockDeps({
          isCompactIdle: vi.fn(() => true),
        });
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('k', { metaKey: true });

        handleGlobalKeydown(event);

        expect(deps.getBottomBar()?.toggleActionList).not.toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();
      });
    });

    describe('Cmd/Ctrl+, Open Settings', () => {
      it('Cmd+, calls showSettingsWindow', () => {
        const deps = createMockDeps();
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent(',', { metaKey: true });

        handleGlobalKeydown(event);

        expect(showSettingsWindow).toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();
        expect(event.stopPropagation).toHaveBeenCalled();
      });

      it('Ctrl+, calls showSettingsWindow', () => {
        const deps = createMockDeps();
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent(',', { ctrlKey: true });

        handleGlobalKeydown(event);

        expect(showSettingsWindow).toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();
        expect(event.stopPropagation).toHaveBeenCalled();
      });

      it('plain , does nothing', () => {
        const deps = createMockDeps();
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent(',');

        handleGlobalKeydown(event);

        expect(showSettingsWindow).not.toHaveBeenCalled();
      });

      it('Cmd+, does not interfere with context hint Tab', () => {
        const hint = {
          type: 'prefix',
          provider: { id: 'portals', type: 'url', display: { name: 'Portals', icon: '🔗' }, triggers: ['portals'] }
        } as any;
        const deps = createMockDeps({
          getContextHint: vi.fn(() => hint),
          getActiveContext: vi.fn(() => null),
        });
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);

        const tabEvent = createKeyEvent('Tab');
        handleGlobalKeydown(tabEvent);
        expect(contextModeService.activate).toHaveBeenCalled();

        const settingsEvent = createKeyEvent(',', { metaKey: true });
        handleGlobalKeydown(settingsEvent);
        expect(showSettingsWindow).toHaveBeenCalled();
      });
    });

    describe('Close Action Panel', () => {
      it('Escape closes action panel from the global handler when focus is outside the popup', () => {
        const bottomBar = { isOpen: vi.fn(() => true), closeActionList: vi.fn(), toggleActionList: vi.fn() };
        const deps = createMockDeps({
          getBottomBar: vi.fn(() => bottomBar),
        });
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Escape');

        // Focus is on the main search input (or anywhere outside .action-popup):
        // its `closest('.action-popup')` returns null, so the global handler
        // must close the panel to prevent Esc from falling through to
        // tryHandleEscape and hiding the window.
        (document as any)._activeElement = {
          tagName: 'INPUT',
          closest: vi.fn(() => null),
        };

        handleGlobalKeydown(event);

        expect(bottomBar.closeActionList).toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();
        // The window must not be hidden while the panel is still open.
        expect(hideWindow).not.toHaveBeenCalled();

        (document as any)._activeElement = null;
      });

      it('Escape does NOT close action panel when focus is inside the popup (popup owns the chain)', () => {
        const bottomBar = { isOpen: vi.fn(() => true), closeActionList: vi.fn(), toggleActionList: vi.fn() };
        const deps = createMockDeps({
          getBottomBar: vi.fn(() => bottomBar),
        });
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Escape');

        // Focus is inside the popup: closest('.action-popup') returns the popup.
        // Global handler must step aside so the popup's own Esc listener can
        // run the Raycast-style chain (clear the popup search first).
        const popupEl = { tagName: 'DIV' };
        (document as any)._activeElement = {
          tagName: 'INPUT',
          closest: vi.fn((sel: string) => sel === '.action-popup' ? popupEl : null),
        };

        handleGlobalKeydown(event);

        expect(bottomBar.closeActionList).not.toHaveBeenCalled();
        expect(event.preventDefault).not.toHaveBeenCalled();

        (document as any)._activeElement = null;
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

      it('Backspace does NOT close action panel when its search input has content', () => {
        const bottomBar = { isOpen: vi.fn(() => true), closeActionList: vi.fn(), toggleActionList: vi.fn() };
        const searchInput = { focus: vi.fn(), value: '' };
        const deps = createMockDeps({
          getBottomBar: vi.fn(() => bottomBar),
          getSearchInput: vi.fn(() => searchInput as any),
        });
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Backspace');

        // Simulate: a text input (not the main search) is focused with content
        const panelInput = { tagName: 'INPUT', type: 'text', value: 'cli' };
        (document as any)._activeElement = panelInput;

        handleGlobalKeydown(event);

        expect(bottomBar.closeActionList).not.toHaveBeenCalled();
        expect(event.preventDefault).not.toHaveBeenCalled();

        // Clean up
        (document as any)._activeElement = null;
      });

      it('Backspace closes action panel when its search input is empty', () => {
        const bottomBar = { isOpen: vi.fn(() => true), closeActionList: vi.fn(), toggleActionList: vi.fn() };
        const searchInput = { focus: vi.fn(), value: '' };
        const deps = createMockDeps({
          getBottomBar: vi.fn(() => bottomBar),
          getSearchInput: vi.fn(() => searchInput as any),
        });
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Backspace');

        // Simulate: a text input (not the main search) is focused but empty
        const panelInput = { tagName: 'INPUT', type: 'text', value: '' };
        (document as any)._activeElement = panelInput;

        handleGlobalKeydown(event);

        expect(bottomBar.closeActionList).toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();

        // Clean up
        (document as any)._activeElement = null;
      });
    });

    describe('Route to Active View — action panel interaction', () => {
      it('ArrowDown is forwarded to third-party extension when action panel is closed', () => {
        viewManager.activeView = 'org.asyar.tauri-docs/DocsView';
        vi.mocked(isBuiltInFeature).mockReturnValue(false);
        const deps = createMockDeps();
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('ArrowDown');

        handleGlobalKeydown(event);

        expect(extensionManager.forwardKeyToActiveView).toHaveBeenCalledWith(
          expect.objectContaining({ key: 'ArrowDown' })
        );
        expect(event.preventDefault).toHaveBeenCalled();
        expect(event.stopPropagation).toHaveBeenCalled();
      });

      it('ArrowDown is NOT forwarded when action panel is open', () => {
        viewManager.activeView = 'org.asyar.tauri-docs/DocsView';
        vi.mocked(isBuiltInFeature).mockReturnValue(false);
        const bottomBar = { isOpen: vi.fn(() => true), closeActionList: vi.fn(), toggleActionList: vi.fn() };
        const deps = createMockDeps({ getBottomBar: vi.fn(() => bottomBar) });
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('ArrowDown');

        handleGlobalKeydown(event);

        expect(extensionManager.forwardKeyToActiveView).not.toHaveBeenCalled();
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(event.stopPropagation).not.toHaveBeenCalled();
      });

      it('ArrowUp is NOT forwarded when action panel is open', () => {
        viewManager.activeView = 'org.asyar.tauri-docs/DocsView';
        vi.mocked(isBuiltInFeature).mockReturnValue(false);
        const bottomBar = { isOpen: vi.fn(() => true), closeActionList: vi.fn(), toggleActionList: vi.fn() };
        const deps = createMockDeps({ getBottomBar: vi.fn(() => bottomBar) });
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('ArrowUp');

        handleGlobalKeydown(event);

        expect(extensionManager.forwardKeyToActiveView).not.toHaveBeenCalled();
      });

      it('Enter is NOT forwarded when action panel is open', () => {
        viewManager.activeView = 'org.asyar.tauri-docs/DocsView';
        vi.mocked(isBuiltInFeature).mockReturnValue(false);
        const bottomBar = { isOpen: vi.fn(() => true), closeActionList: vi.fn(), toggleActionList: vi.fn() };
        const deps = createMockDeps({ getBottomBar: vi.fn(() => bottomBar) });
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Enter');

        handleGlobalKeydown(event);

        expect(extensionManager.forwardKeyToActiveView).not.toHaveBeenCalled();
      });

      it('stopPropagation is called when forwarding each key type to third-party extensions', () => {
        viewManager.activeView = 'org.asyar.tauri-docs/DocsView';
        vi.mocked(isBuiltInFeature).mockReturnValue(false);
        const deps = createMockDeps();
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);

        for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab']) {
          const event = createKeyEvent(key);
          handleGlobalKeydown(event);
          expect(event.stopPropagation).toHaveBeenCalled();
        }
      });

      it('stopPropagation is NOT called for built-in extensions', () => {
        viewManager.activeView = 'calculator/CalculatorView';
        vi.mocked(isBuiltInFeature).mockReturnValue(true);
        const deps = createMockDeps();
        const { handleGlobalKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('ArrowDown');

        handleGlobalKeydown(event);

        expect(extensionManager.forwardKeyToActiveView).not.toHaveBeenCalled();
        expect(event.stopPropagation).not.toHaveBeenCalled();
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

      it('Enter with chip active + empty query → does NOT call handleEnterKey or contextModeService.activate', () => {
        searchStores.selectedIndex = -1;
        const deps = createMockDeps({
          getActiveContext: vi.fn(() => ({ provider: { id: 'portal_1' }, query: '' } as any)),
          getSearchResultsLength: vi.fn(() => 1),
        });
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Enter');

        handleKeydown(event);

        expect(deps.handleEnterKey).not.toHaveBeenCalled();
        expect(contextModeService.activate).not.toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();
      });

      it('Enter with chip active + whitespace-only query → treated as empty, no activation', () => {
        const deps = createMockDeps({
          getActiveContext: vi.fn(() => ({ provider: { id: 'portal_1' }, query: '   ' } as any)),
        });
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Enter');

        handleKeydown(event);

        expect(contextModeService.activate).not.toHaveBeenCalled();
        expect(deps.handleEnterKey).not.toHaveBeenCalled();
      });
    });

    describe('Compact idle mode', () => {
      it('ArrowDown in compact idle calls onCompactExpand', () => {
        const onCompactExpand = vi.fn();
        const deps = createMockDeps({
          isCompactIdle: vi.fn(() => true),
          onCompactExpand,
        });
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('ArrowDown');

        handleKeydown(event);

        expect(onCompactExpand).toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();
      });

      it('ArrowUp in compact idle is swallowed without changing selectedIndex', () => {
        searchStores.selectedIndex = -1;
        const deps = createMockDeps({
          isCompactIdle: vi.fn(() => true),
          getSearchResultsLength: vi.fn(() => 5),
        });
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('ArrowUp');

        handleKeydown(event);

        expect(searchStores.selectedIndex).toBe(-1);
        expect(event.preventDefault).toHaveBeenCalled();
      });

      it('Enter in compact idle is swallowed without calling handleEnterKey', () => {
        const deps = createMockDeps({
          isCompactIdle: vi.fn(() => true),
        });
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Enter');

        handleKeydown(event);

        expect(deps.handleEnterKey).not.toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();
      });

      it('navigation keys work normally when isCompactIdle returns false', () => {
        searchStores.selectedIndex = 0;
        const deps = createMockDeps({
          isCompactIdle: vi.fn(() => false),
          getSearchResultsLength: vi.fn(() => 5),
        });
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('ArrowDown');

        handleKeydown(event);

        expect(searchStores.selectedIndex).toBe(1);
      });
    });

    describe('Escape behavior', () => {
      it('Escape hides launcher when no active view', async () => {
        const deps = createMockDeps();
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Escape');

        handleKeydown(event);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(hideWindow).toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();
      });

      it('Escape in view with empty search pops the view when escapeInViewBehavior is "go-back"', () => {
        viewManager.activeView = 'ext/View';
        vi.mocked(settingsService.getSettings).mockReturnValue({
          general: {
            startAtLogin: false,
            showDockIcon: true,
            escapeInViewBehavior: 'go-back'
          },
          search: { searchApplications: true, searchSystemPreferences: true, fuzzySearch: true },
          shortcut: { modifier: 'Alt', key: 'Space' },
          appearance: { theme: 'system', launchView: 'default', windowWidth: 800, windowHeight: 600 },
          extensions: { enabled: {} },
          calculator: { refreshInterval: 6 }
        } as any);
        const deps = createMockDeps();
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Escape');

        handleKeydown(event);

        expect(extensionManager.goBack).toHaveBeenCalled();
        expect(deps.setLocalSearchValue).not.toHaveBeenCalled();
        expect(hideWindow).not.toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();
      });

      it('Escape in view with non-empty search clears search first when escapeInViewBehavior is "go-back"', () => {
        viewManager.activeView = 'ext/View';
        vi.mocked(settingsService.getSettings).mockReturnValue({
          general: {
            startAtLogin: false,
            showDockIcon: true,
            escapeInViewBehavior: 'go-back'
          },
          search: { searchApplications: true, searchSystemPreferences: true, fuzzySearch: true },
          shortcut: { modifier: 'Alt', key: 'Space' },
          appearance: { theme: 'system', launchView: 'default', windowWidth: 800, windowHeight: 600 },
          extensions: { enabled: {} },
          calculator: { refreshInterval: 6 }
        } as any);
        const deps = createMockDeps({
          getLocalSearchValue: vi.fn(() => 'foo'),
        });
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Escape');

        handleKeydown(event);

        expect(deps.setLocalSearchValue).toHaveBeenCalledWith('');
        expect(extensionManager.goBack).not.toHaveBeenCalled();
        expect(hideWindow).not.toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();
      });

      it('Escape in view hides immediately, then drains stack and clears search when escapeInViewBehavior is "hide-and-reset"', async () => {
        viewManager.activeView = 'ext/View';
        let stackSize = 2;
        vi.mocked(viewManager.getNavigationStackSize).mockImplementation(() => stackSize);
        vi.mocked(extensionManager.goBack).mockImplementation(() => { stackSize = Math.max(0, stackSize - 1); });
        vi.mocked(settingsService.getSettings).mockReturnValue({
          general: {
            startAtLogin: false,
            showDockIcon: true,
            escapeInViewBehavior: 'hide-and-reset'
          },
          search: { searchApplications: true, searchSystemPreferences: true, fuzzySearch: true },
          shortcut: { modifier: 'Alt', key: 'Space' },
          appearance: { theme: 'system', launchView: 'default', windowWidth: 800, windowHeight: 600 },
          extensions: { enabled: {} },
          calculator: { refreshInterval: 6 }
        } as any);
        const deps = createMockDeps();
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Escape');

        handleKeydown(event);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(hideWindow).toHaveBeenCalled();
        expect(extensionManager.goBack).toHaveBeenCalledTimes(2);
        expect(deps.setLocalSearchValue).toHaveBeenCalledWith('');
        expect(event.preventDefault).toHaveBeenCalled();
      });

      it('Escape "hide-and-reset" drains the stack AFTER hideWindow resolves, not before', async () => {
        viewManager.activeView = 'ext/View';
        let stackSize = 2;
        vi.mocked(viewManager.getNavigationStackSize).mockImplementation(() => stackSize);
        vi.mocked(extensionManager.goBack).mockImplementation(() => { stackSize = Math.max(0, stackSize - 1); });
        vi.mocked(settingsService.getSettings).mockReturnValue({
          general: {
            startAtLogin: false,
            showDockIcon: true,
            escapeInViewBehavior: 'hide-and-reset'
          },
          search: { searchApplications: true, searchSystemPreferences: true, fuzzySearch: true },
          shortcut: { modifier: 'Alt', key: 'Space' },
          appearance: { theme: 'system', launchView: 'default', windowWidth: 800, windowHeight: 600 },
          extensions: { enabled: {} },
          calculator: { refreshInterval: 6 }
        } as any);

        // Make hideWindow resolve after a short delay so we can observe ordering.
        let hideResolved = false;
        vi.mocked(hideWindow).mockImplementationOnce(() => new Promise<void>((r) => {
          setTimeout(() => { hideResolved = true; r(); }, 10);
        }));

        const deps = createMockDeps();
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Escape');

        handleKeydown(event);

        // Flush microtasks — drainAndClear must NOT have run yet because
        // hideWindow hasn't resolved.
        await Promise.resolve();
        await Promise.resolve();
        expect(hideResolved).toBe(false);
        expect(extensionManager.goBack).not.toHaveBeenCalled();
        expect(deps.setLocalSearchValue).not.toHaveBeenCalled();

        // Wait for the hide to resolve and the chained drain to run.
        await new Promise((r) => setTimeout(r, 30));
        expect(hideResolved).toBe(true);
        expect(extensionManager.goBack).toHaveBeenCalledTimes(2);
        expect(deps.setLocalSearchValue).toHaveBeenCalledWith('');
      });

      it('drainAndClear aborts and warns if goBack fails to shrink the nav stack', async () => {
        viewManager.activeView = 'ext/View';
        // Simulate a broken goBack that never pops — the loop must detect the
        // violated invariant and bail out instead of spinning.
        vi.mocked(viewManager.getNavigationStackSize).mockImplementation(() => 3);
        vi.mocked(extensionManager.goBack).mockImplementation(() => { /* no-op: stack doesn't shrink */ });
        vi.mocked(settingsService.getSettings).mockReturnValue({
          general: {
            startAtLogin: false,
            showDockIcon: true,
            escapeInViewBehavior: 'hide-and-reset'
          },
          search: { searchApplications: true, searchSystemPreferences: true, fuzzySearch: true },
          shortcut: { modifier: 'Alt', key: 'Space' },
          appearance: { theme: 'system', launchView: 'default', windowWidth: 800, windowHeight: 600 },
          extensions: { enabled: {} },
          calculator: { refreshInterval: 6 }
        } as any);
        const deps = createMockDeps();
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Escape');

        handleKeydown(event);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(extensionManager.goBack).toHaveBeenCalledTimes(1);
        expect(logService.warn).toHaveBeenCalledWith(expect.stringContaining('drainAndClear'));
        expect(deps.setLocalSearchValue).toHaveBeenCalledWith('');
      });

      it('Escape in view hides when escapeInViewBehavior is "close-window"', async () => {
        viewManager.activeView = 'ext/View';
        vi.mocked(settingsService.getSettings).mockReturnValue({
          general: {
            startAtLogin: false,
            showDockIcon: true,
            escapeInViewBehavior: 'close-window'
          },
          search: { searchApplications: true, searchSystemPreferences: true, fuzzySearch: true },
          shortcut: { modifier: 'Alt', key: 'Space' },
          appearance: { theme: 'system', launchView: 'default', windowWidth: 800, windowHeight: 600 },
          extensions: { enabled: {} },
          calculator: { refreshInterval: 6 }
        } as any);
        const deps = createMockDeps();
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Escape');

        handleKeydown(event);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(hideWindow).toHaveBeenCalled();
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

      // Built-in features (clipboard-history, snippets, store) own Enter via a
      // window-level keydown listener bound in viewActivated. They signal this
      // by setting activeViewPrimaryActionLabel ("Paste", "Show Details", etc).
      // The launcher must not preventDefault/stopPropagation in that case —
      // doing so blocks the bubble-phase window listener from ever firing.
      it('Enter in searchable view does NOT submit or stopPropagation when extension owns the primary action', () => {
        viewManager.activeView = 'clipboard-history/DefaultView';
        viewManager.activeViewSearchable = true;
        viewManager.activeViewPrimaryActionLabel = 'Paste';
        const deps = createMockDeps({
          getActiveContext: vi.fn(() => null),
          getLocalSearchValue: vi.fn(() => 'foo'),
        });
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Enter');

        handleKeydown(event);

        expect(extensionManager.handleViewSubmit).not.toHaveBeenCalled();
        expect(deps.setLocalSearchValue).not.toHaveBeenCalled();
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(event.stopPropagation).not.toHaveBeenCalled();
      });

      it('Enter in searchable view with empty local search does NOT consume the event', () => {
        viewManager.activeView = 'clipboard-history/DefaultView';
        viewManager.activeViewSearchable = true;
        viewManager.activeViewPrimaryActionLabel = 'Paste';
        const deps = createMockDeps({
          getActiveContext: vi.fn(() => null),
          getLocalSearchValue: vi.fn(() => ''),
        });
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Enter');

        handleKeydown(event);

        expect(extensionManager.handleViewSubmit).not.toHaveBeenCalled();
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(event.stopPropagation).not.toHaveBeenCalled();
      });

      it('Enter in active context with empty query does NOT consume the event', () => {
        viewManager.activeView = 'ext/View';
        const deps = createMockDeps({
          getActiveContext: vi.fn(() => ({ provider: { id: 'test' }, query: '' } as any)),
          getContextQuery: vi.fn(() => ''),
        });
        const { handleKeydown } = createKeyboardHandlers(deps);
        const event = createKeyEvent('Enter');

        handleKeydown(event);

        expect(extensionManager.handleViewSubmit).not.toHaveBeenCalled();
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(event.stopPropagation).not.toHaveBeenCalled();
      });
    });

  });
});
