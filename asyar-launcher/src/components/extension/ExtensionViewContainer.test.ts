/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
  transformCallback: vi.fn(() => 0),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/extension/extensionDiscovery', () => ({
  isBuiltInFeature: vi.fn((id: string) => id === 'test-builtin'),
}));

vi.mock('../../services/search/searchBarAccessoryService.svelte', () => ({
  searchBarAccessoryService: {
    active: null,
    clear: vi.fn(),
  },
}));

vi.mock('../../services/search/applyAccessoryFromCommand', () => ({
  applyAccessoryFromCommand: vi.fn(),
}));

import ExtensionViewContainer from './ExtensionViewContainer.svelte';
import TestView from '../../built-in-features/help/DefaultView.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { shortcutStore } from '../../built-in-features/shortcuts/shortcutStore.svelte';
import shortcutsExt, {
  DefaultView as ShortcutsDefaultView,
  ShortcutEditView,
} from '../../built-in-features/shortcuts';

describe('ExtensionViewContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('safely renders fallback error when viewName does not match and module.default is an object', () => {
    // Mimics built-in feature like Store:
    // named exports are DefaultView, DetailView; default export is `new StoreExtension()` (an object)
    const mockModule = {
      DefaultView: TestView,
      default: {
        someMethod: vi.fn(),
      },
    };

    const mockExtensionManager = {
      getManifestById: vi.fn().mockReturnValue({
        id: 'test-builtin',
        commands: [],
      }),
      getLoadedExtensionModule: vi.fn().mockReturnValue(mockModule),
    };

    // Before fix, this would throw "TypeError: F is not a function" because it fell back
    // to mockModule.default and tried to call it as a Svelte component function.
    const { container } = render(ExtensionViewContainer, {
      activeView: 'test-builtin/__TBD__',
      extensionManager: mockExtensionManager,
    });

    expect(container.textContent).toContain(
      "Error: Built-in feature test-builtin has no export matching '__TBD__'",
    );
  });

  it('renders valid component function when viewName matches', () => {
    const mockModule = {
      DefaultView: TestView,
      default: {
        someMethod: vi.fn(),
      },
    };

    const mockExtensionManager = {
      getManifestById: vi.fn().mockReturnValue({
        id: 'test-builtin',
        commands: [],
      }),
      getLoadedExtensionModule: vi.fn().mockReturnValue(mockModule),
    };

    const { container } = render(ExtensionViewContainer, {
      activeView: 'test-builtin/DefaultView',
      extensionManager: mockExtensionManager,
    });

    expect(container.textContent).not.toContain('Error: Built-in feature');
  });

  it('switches cleanly from ShortcutEditView back to shortcuts DefaultView on Escape', async () => {
    const { isBuiltInFeature } = await import('../../services/extension/extensionDiscovery');
    vi.mocked(isBuiltInFeature).mockReturnValue(true);

    shortcutStore.shortcuts = [
      {
        id: 'sc-1',
        objectId: 'app-terminal',
        itemName: 'Terminal',
        itemType: 'application',
        shortcut: 'Cmd+T',
        itemPath: '/Applications/Utilities/Terminal.app',
        createdAt: Date.now(),
      },
    ];
    viewManager.init(
      new Map([['shortcuts', { id: 'shortcuts', name: 'Shortcuts', searchable: true } as any]]),
    );

    const mockModule = {
      DefaultView: ShortcutsDefaultView,
      ShortcutEditView,
      default: shortcutsExt,
    };
    const mockExtensionManager = {
      getManifestById: vi.fn().mockReturnValue({ id: 'shortcuts', commands: [] }),
      getLoadedExtensionModule: vi.fn().mockReturnValue(mockModule),
      getCommandIcon: vi.fn(),
    };

    viewManager.navigateToView('shortcuts/DefaultView');
    viewManager.navigateToView('shortcuts/ShortcutEditView', { searchable: false });

    const { rerender, container } = render(ExtensionViewContainer, {
      activeView: viewManager.activeView!,
      extensionManager: mockExtensionManager,
    });

    const { fireEvent } = await import('@testing-library/svelte');
    await fireEvent.keyDown(window, { key: 'Escape', bubbles: true, cancelable: true });

    expect(viewManager.activeView).toBe('shortcuts/DefaultView');
    await rerender({
      activeView: viewManager.activeView!,
      extensionManager: mockExtensionManager,
    });
    expect(container.textContent).toContain('Terminal');
  });
});
