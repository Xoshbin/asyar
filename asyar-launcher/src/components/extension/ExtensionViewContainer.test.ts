/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';

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

vi.mock('../../lib/themeFonts', () => ({
  buildFontFaceCSS: vi.fn().mockResolvedValue(''),
}));

import ExtensionViewContainer from './ExtensionViewContainer.svelte';
import TestView from '../../built-in-features/help/DefaultView.svelte';

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

  it('applies overflow-y-auto and custom-scrollbar for built-in views', () => {
    const mockModule = {
      DefaultView: TestView,
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

    const root = container.querySelector('[data-extension-view]');
    expect(root?.classList.contains('overflow-y-auto')).toBe(true);
    expect(root?.classList.contains('custom-scrollbar')).toBe(true);
    expect(root?.classList.contains('overflow-hidden')).toBe(false);
  });

  it('applies overflow-hidden for third-party iframe views', () => {
    const mockExtensionManager = {
      getManifestById: vi.fn().mockReturnValue({
        id: 'external-extension',
        commands: [],
      }),
      getLoadedExtensionModule: vi.fn().mockReturnValue(null),
    };

    const { container } = render(ExtensionViewContainer, {
      activeView: 'external-extension/view',
      extensionManager: mockExtensionManager,
    });

    const root = container.querySelector('[data-extension-view]');
    expect(root?.classList.contains('overflow-hidden')).toBe(true);
    expect(root?.classList.contains('overflow-y-auto')).toBe(false);
    expect(root?.classList.contains('custom-scrollbar')).toBe(false);
  });
});
