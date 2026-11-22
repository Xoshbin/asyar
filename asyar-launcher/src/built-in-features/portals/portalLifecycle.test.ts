/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReplaceDynamicCommandsBuiltin = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockPortalOpenLink = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockResolvePortalTemplate = vi.hoisted(() => vi.fn(async (url: string) => url));

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('../../services/search/SearchService', () => ({
  searchService: {
    indexItem: vi.fn(),
    deleteItem: vi.fn().mockResolvedValue(undefined),
    saveIndex: vi.fn(),
  },
}));
vi.mock('../../lib/ipc/commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/ipc/commands')>();
  return {
    ...actual,
    replaceDynamicCommandsBuiltin: mockReplaceDynamicCommandsBuiltin,
    portalOpenLink: mockPortalOpenLink,
  };
});
vi.mock('../../lib/placeholders/placeholderResolver', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../lib/placeholders/placeholderResolver')>();
  return {
    ...actual,
    resolvePortalTemplate: mockResolvePortalTemplate,
  };
});
vi.mock('./portalStore.svelte', () => ({
  portalStore: {
    portals: [],
    getAll: vi.fn(() => []),
    getById: vi.fn(),
    remove: vi.fn(),
    recordOpen: vi.fn(),
  },
}));
vi.mock('../shortcuts/shortcutService', () => ({
  shortcutService: { unregister: vi.fn().mockResolvedValue(undefined) },
}));

import {
  deletePortal,
  dispatchPortalCommand,
  openPortal,
  syncAllPortalsToIndex,
} from './portalLifecycle';
import { portalStore } from './portalStore.svelte';
import { shortcutService } from '../shortcuts/shortcutService';

describe('deletePortal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('removes the portal from the store and unregisters both dyn and legacy shortcuts', async () => {
    await deletePortal('p1');
    expect(portalStore.remove).toHaveBeenCalledWith('p1');
    expect(shortcutService.unregister).toHaveBeenCalledWith('cmd_portals_dyn_p1');
    expect(shortcutService.unregister).toHaveBeenCalledWith('cmd_portals_p1');
    expect(mockReplaceDynamicCommandsBuiltin).toHaveBeenCalledWith('portals', []);
  });
});

describe('syncAllPortalsToIndex', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers visible portals with extracted arguments and skips hiddenInRootSearch portals', async () => {
    vi.mocked(portalStore.getAll).mockReturnValue([
      {
        id: 'g',
        name: 'Search Google',
        url: 'https://google.com/search?q={argument name="Query"}',
        icon: '🌐',
        createdAt: 1,
      },
      {
        id: 'hidden',
        name: 'Secret',
        url: 'https://example.com',
        icon: '🔒',
        hiddenInRootSearch: true,
        createdAt: 2,
      },
    ]);

    await syncAllPortalsToIndex();

    expect(mockReplaceDynamicCommandsBuiltin).toHaveBeenCalledWith('portals', [
      expect.objectContaining({
        id: 'g',
        name: 'Search Google',
        typeLabel: 'Portal',
        arguments: [
          expect.objectContaining({
            name: 'Query',
            type: 'text',
            placeholder: 'Query',
            required: true,
          }),
        ],
      }),
    ]);
  });
});

describe('openPortal / dispatchPortalCommand', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves template with args, opens link with openWith, and records openCount', async () => {
    mockResolvePortalTemplate.mockResolvedValueOnce('https://google.com/search?q=asyar');
    const portal = {
      id: 'g',
      name: 'Search Google',
      url: 'https://google.com/search?q={argument}',
      icon: '🌐',
      openWith: '/Applications/Safari.app',
      createdAt: 1,
    };
    vi.mocked(portalStore.getById).mockReturnValue(portal);

    await dispatchPortalCommand('g', { arguments: { Argument: 'asyar' } });

    expect(mockResolvePortalTemplate).toHaveBeenCalledWith(
      'https://google.com/search?q={argument}',
      { query: 'asyar', args: { Argument: 'asyar' } },
      true,
    );
    expect(mockPortalOpenLink).toHaveBeenCalledWith(
      'https://google.com/search?q=asyar',
      '/Applications/Safari.app',
    );
    expect(portalStore.recordOpen).toHaveBeenCalledWith('g');
  });

  it('supports overrideOpenWith when invoked from Open With… action', async () => {
    mockResolvePortalTemplate.mockResolvedValueOnce('/Users/test/Projects');
    const portal = {
      id: 'proj',
      name: 'Projects',
      url: '~/Projects',
      icon: '📁',
      createdAt: 1,
    };

    await openPortal(portal, undefined, '/Applications/Visual Studio Code.app');

    expect(mockPortalOpenLink).toHaveBeenCalledWith(
      '/Users/test/Projects',
      '/Applications/Visual Studio Code.app',
    );
  });
});
