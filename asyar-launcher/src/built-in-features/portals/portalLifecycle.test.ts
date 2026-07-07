/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('../../services/search/SearchService', () => ({
  searchService: { indexItem: vi.fn(), deleteItem: vi.fn(), saveIndex: vi.fn() },
}));
vi.mock('../../services/extension/commandService.svelte', () => ({
  commandService: { registerCommand: vi.fn(), unregisterCommand: vi.fn() },
}));
vi.mock('../../services/context/contextModeService.svelte', () => ({
  contextModeService: {
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    updateQuery: vi.fn(),
  },
}));
vi.mock('./portalStore.svelte', () => ({
  portalStore: { portals: [], getAll: vi.fn(() => []), getById: vi.fn(), remove: vi.fn() },
}));
vi.mock('../shortcuts/shortcutService', () => ({
  shortcutService: { unregister: vi.fn() },
}));
vi.mock('../../lib/placeholders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/placeholders')>();
  return { ...actual, resolveTemplate: vi.fn() };
});

import { deletePortal, removePortalFromIndex, syncPortalToIndex } from './portalLifecycle';
import { portalStore } from './portalStore.svelte';
import { searchService } from '../../services/search/SearchService';
import { commandService } from '../../services/extension/commandService.svelte';
import { contextModeService } from '../../services/context/contextModeService.svelte';
import { shortcutService } from '../shortcuts/shortcutService';
import { invoke } from '@tauri-apps/api/core';
import { resolveTemplate } from '../../lib/placeholders';

describe('deletePortal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('removes the portal from the store', async () => {
    await deletePortal('p1');
    expect(portalStore.remove).toHaveBeenCalledWith('p1');
  });

  it('unregisters the item shortcut bound to the portal command', async () => {
    // Regression for issue #433: deleting a portal left its global hotkey
    // registered — pressing it kept firing the deleted portal.
    await deletePortal('p1');
    expect(shortcutService.unregister).toHaveBeenCalledWith('cmd_portals_p1');
  });

  it('removes the search-index entry, runtime command, and context provider', async () => {
    await deletePortal('p1');
    expect(searchService.deleteItem).toHaveBeenCalledWith('cmd_portals_p1');
    expect(commandService.unregisterCommand).toHaveBeenCalledWith('cmd_portals_p1');
    expect(contextModeService.unregisterProvider).toHaveBeenCalledWith('portal_p1');
  });

  it('still unregisters the shortcut when index removal fails', async () => {
    vi.mocked(searchService.deleteItem).mockRejectedValueOnce(new Error('index gone'));
    await expect(deletePortal('p1')).rejects.toThrow('index gone');
    expect(portalStore.remove).toHaveBeenCalledWith('p1');
    expect(shortcutService.unregister).toHaveBeenCalledWith('cmd_portals_p1');
  });
});

describe('removePortalFromIndex', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does NOT touch the item shortcut (edit flow re-indexes the same portal id)', async () => {
    await removePortalFromIndex('p1');
    expect(shortcutService.unregister).not.toHaveBeenCalled();
  });
});

describe('Portal context provider metadata', () => {
  beforeEach(() => vi.clearAllMocks());

  function getRegisteredProvider(portalId: string) {
    return vi
      .mocked(contextModeService.registerProvider)
      .mock.calls.find((c) => c[0].id === `portal_${portalId}`)![0];
  }

  it('links the provider to its command object id', async () => {
    const portal = { id: '20', name: 'Google', url: 'https://google.com/?q={query}', icon: '🔍' };
    await syncPortalToIndex(portal as any);
    expect(getRegisteredProvider('20').commandObjectId).toBe('cmd_portals_20');
  });

  it('marks needsQuery true for a {query} portal', async () => {
    const portal = { id: '21', name: 'Google', url: 'https://google.com/?q={query}', icon: '🔍' };
    await syncPortalToIndex(portal as any);
    expect(getRegisteredProvider('21').needsQuery).toBe(true);
  });

  it('marks needsQuery true for an {Argument} portal (query alias)', async () => {
    const portal = { id: '22', name: 'Wiki', url: 'https://wiki.com/?q={Argument}', icon: '📖' };
    await syncPortalToIndex(portal as any);
    expect(getRegisteredProvider('22').needsQuery).toBe(true);
  });

  it('marks needsQuery false for a portal with no query placeholder', async () => {
    const portal = { id: '23', name: 'GitHub', url: 'https://github.com', icon: '🐙' };
    await syncPortalToIndex(portal as any);
    expect(getRegisteredProvider('23').needsQuery).toBe(false);
  });
});

describe('Portal onActivate guard', () => {
  beforeEach(() => vi.clearAllMocks());

  async function getOnActivate(portal: any) {
    await syncPortalToIndex(portal as any);
    const call = vi
      .mocked(contextModeService.registerProvider)
      .mock.calls.find((c) => c[0].id === `portal_${portal.id}`);
    return call![0].onActivate!;
  }

  it('empty string query (Tab/trigger just set chip) → does NOT open browser', async () => {
    const portal = { id: '1', name: 'Google', url: 'https://google.com/?q={query}', icon: '🔍' };
    const onActivate = await getOnActivate(portal);
    await onActivate('');
    expect(invoke).not.toHaveBeenCalledWith('plugin:opener|open_url', expect.anything());
  });

  it('undefined query (same guard) → does NOT open browser', async () => {
    const portal = { id: '2', name: 'Google', url: 'https://google.com/?q={query}', icon: '🔍' };
    const onActivate = await getOnActivate(portal);
    await onActivate(undefined);
    expect(invoke).not.toHaveBeenCalledWith('plugin:opener|open_url', expect.anything());
  });

  it('non-empty query → resolves template and opens browser', async () => {
    const portal = { id: '3', name: 'Google', url: 'https://google.com/?q={query}', icon: '🔍' };
    vi.mocked(resolveTemplate).mockResolvedValue('https://google.com/?q=hello');
    const onActivate = await getOnActivate(portal);
    await onActivate('hello');
    expect(resolveTemplate).toHaveBeenCalledWith(
      portal.url,
      { query: 'hello' },
      { encodeValues: true },
    );
    expect(invoke).toHaveBeenCalledWith('plugin:opener|open_url', {
      url: 'https://google.com/?q=hello',
    });
  });

  it('{Selected Text} portal with non-empty query → opens browser', async () => {
    const portal = {
      id: '4',
      name: 'Translate',
      url: 'https://translate.google.com/?text={Selected Text}',
      icon: '🌐',
    };
    vi.mocked(resolveTemplate).mockResolvedValue('https://translate.google.com/?text=hello+world');
    const onActivate = await getOnActivate(portal);
    await onActivate('hello world');
    expect(invoke).toHaveBeenCalledWith('plugin:opener|open_url', {
      url: 'https://translate.google.com/?text=hello+world',
    });
  });
});

describe('Portal chip pre-fill (onActivate with empty query)', () => {
  beforeEach(() => vi.clearAllMocks());

  async function getOnActivate(portal: any) {
    await syncPortalToIndex(portal as any);
    const call = vi
      .mocked(contextModeService.registerProvider)
      .mock.calls.find((c) => c[0].id === `portal_${portal.id}`);
    return call![0].onActivate!;
  }

  // resolveChipPrefill is data-driven via PLACEHOLDERS — it calls def.resolve({}) directly,
  // not resolveTemplate. These tests mock resolveTemplate for the onActivate open-URL path
  // and verify updateQuery is called with whatever the placeholder resolver returns.

  it('{query} portal → no pre-fill, no updateQuery call', async () => {
    const portal = { id: '7', name: 'Google', url: 'https://google.com/?q={query}', icon: '🔍' };
    const onActivate = await getOnActivate(portal);
    await onActivate('');
    expect(vi.mocked(contextModeService.updateQuery)).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith('plugin:opener|open_url', expect.anything());
  });

  it('{Argument} alias portal → no pre-fill (treated same as {query})', async () => {
    const portal = { id: '10', name: 'Wiki', url: 'https://wiki.com/?q={Argument}', icon: '📖' };
    const onActivate = await getOnActivate(portal);
    await onActivate('');
    expect(vi.mocked(contextModeService.updateQuery)).not.toHaveBeenCalled();
  });

  it('non-empty query → opens URL (no pre-fill branch reached)', async () => {
    const portal = { id: '11', name: 'Google', url: 'https://google.com/?q={query}', icon: '🔍' };
    vi.mocked(resolveTemplate).mockResolvedValue('https://google.com/?q=hello');
    const onActivate = await getOnActivate(portal);
    await onActivate('hello');
    expect(invoke).toHaveBeenCalledWith('plugin:opener|open_url', {
      url: 'https://google.com/?q=hello',
    });
    expect(vi.mocked(contextModeService.updateQuery)).not.toHaveBeenCalled();
  });
});
