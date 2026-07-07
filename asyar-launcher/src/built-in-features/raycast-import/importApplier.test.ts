import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../snippets/snippetStore.svelte', () => ({
  snippetStore: { getAll: vi.fn(() => []), add: vi.fn() },
}));
vi.mock('../snippets/snippetService', () => ({
  snippetService: { syncToRust: vi.fn(async () => {}) },
}));
vi.mock('../portals/portalStore.svelte', () => ({
  portalStore: { getAll: vi.fn(() => []), add: vi.fn() },
}));
vi.mock('../portals/portalLifecycle', () => ({
  syncPortalToIndex: vi.fn(async () => {}),
}));
vi.mock('../shortcuts/shortcutService', () => ({
  shortcutService: { register: vi.fn(async () => ({ ok: true })) },
}));
vi.mock('../aliases/aliasService', () => ({
  aliasService: {
    findConflict: vi.fn(async () => null),
    register: vi.fn(
      async (objectId: string, alias: string, itemName: string, itemType: string) => ({
        objectId,
        alias,
        itemName,
        itemType,
        createdAt: 0,
      }),
    ),
  },
}));
vi.mock('../aliases/aliasStore.svelte', () => ({
  aliasStore: { addOptimistic: vi.fn() },
}));
vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { applyBundle } from './importApplier';
import type { ImportBundle } from './types';
import { snippetStore } from '../snippets/snippetStore.svelte';
import { snippetService } from '../snippets/snippetService';
import { portalStore } from '../portals/portalStore.svelte';
import { syncPortalToIndex } from '../portals/portalLifecycle';
import { shortcutService } from '../shortcuts/shortcutService';
import { aliasService } from '../aliases/aliasService';
import { aliasStore } from '../aliases/aliasStore.svelte';

const ALL = { snippets: true, portals: true, shortcuts: true, aliases: true };

function makeBundle(overrides: Partial<ImportBundle> = {}): ImportBundle {
  return {
    source: 'rayconfigX',
    snippets: [],
    portals: [],
    shortcuts: [],
    aliases: [],
    skipped: { hotkeys: 0, aliases: 0 },
    ...overrides,
  };
}

describe('applyBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(snippetStore.getAll).mockReturnValue([]);
    vi.mocked(portalStore.getAll).mockReturnValue([]);
    vi.mocked(shortcutService.register).mockResolvedValue({ ok: true });
    vi.mocked(aliasService.findConflict).mockResolvedValue(null);
  });

  it('adds snippets and syncs keywords to Rust', async () => {
    const bundle = makeBundle({
      snippets: [
        { name: 'Sig', keyword: '!sig', expansion: 'Best, John', pinned: false },
        { name: 'Plain', expansion: 'hello', pinned: true, createdAt: 1767323045000 },
      ],
    });

    const summary = await applyBundle(bundle, ALL);

    expect(summary.snippets).toEqual({ added: 2, skipped: 0 });
    expect(snippetStore.add).toHaveBeenCalledTimes(2);
    const first = vi.mocked(snippetStore.add).mock.calls[0][0];
    expect(first.name).toBe('Sig');
    expect(first.keyword).toBe('!sig');
    expect(first.expansion).toBe('Best, John');
    expect(first.id).toBeTruthy();
    const second = vi.mocked(snippetStore.add).mock.calls[1][0];
    expect(second.pinned).toBe(true);
    expect(second.createdAt).toBe(1767323045000);
    expect(snippetService.syncToRust).toHaveBeenCalledTimes(1);
  });

  it('skips duplicate snippets by name+expansion', async () => {
    vi.mocked(snippetStore.getAll).mockReturnValue([
      { id: 'x', name: 'Sig', expansion: 'Best, John', createdAt: 1 },
    ]);
    const bundle = makeBundle({
      snippets: [{ name: 'Sig', expansion: 'Best, John', pinned: false }],
    });

    const summary = await applyBundle(bundle, ALL);

    expect(summary.snippets).toEqual({ added: 0, skipped: 1 });
    expect(snippetStore.add).not.toHaveBeenCalled();
  });

  it('adds portals and indexes them, skipping duplicates by name+url', async () => {
    vi.mocked(portalStore.getAll).mockReturnValue([
      { id: 'p1', name: 'Existing', url: 'https://e.com/{query}', icon: '🌐', createdAt: 1 },
    ]);
    const bundle = makeBundle({
      portals: [
        {
          raycastId: '02A',
          name: 'Google',
          url: 'https://google.com/search?q={query}',
          icon: '🔗',
        },
        { name: 'Existing', url: 'https://e.com/{query}', icon: '🔗' },
      ],
    });

    const summary = await applyBundle(bundle, ALL);

    expect(summary.portals).toEqual({ added: 1, skipped: 1 });
    expect(portalStore.add).toHaveBeenCalledTimes(1);
    const added = vi.mocked(portalStore.add).mock.calls[0][0];
    expect(added.name).toBe('Google');
    expect(added.id).toBeTruthy();
    expect(syncPortalToIndex).toHaveBeenCalledWith(added);
  });

  it('registers app shortcuts through shortcutService', async () => {
    const bundle = makeBundle({
      shortcuts: [
        {
          target: {
            kind: 'app',
            path: '/Applications/iTerm.app',
            objectId: 'app_123',
            itemName: 'iTerm',
            itemIcon: 'icon-data',
          },
          shortcut: 'Control+Alt+Shift+Super+I',
        },
      ],
    });

    const summary = await applyBundle(bundle, ALL);

    expect(summary.shortcuts).toEqual({ added: 1, skipped: 0 });
    expect(shortcutService.register).toHaveBeenCalledWith(
      'app_123',
      'iTerm',
      'application',
      'Control+Alt+Shift+Super+I',
      '/Applications/iTerm.app',
      'icon-data',
    );
  });

  it('counts conflicting shortcuts as skipped', async () => {
    vi.mocked(shortcutService.register).mockResolvedValue({
      ok: false,
      conflict: { objectId: 'other', itemName: 'Other' },
    });
    const bundle = makeBundle({
      shortcuts: [
        {
          target: { kind: 'app', path: '/a.app', objectId: 'app_1', itemName: 'A' },
          shortcut: 'Super+Shift+A',
        },
      ],
    });

    const summary = await applyBundle(bundle, ALL);

    expect(summary.shortcuts).toEqual({ added: 0, skipped: 1 });
  });

  it('binds quicklink hotkeys to the imported portal command', async () => {
    const bundle = makeBundle({
      portals: [{ raycastId: '02A', name: 'Google', url: 'https://g.com/{query}', icon: '🔗' }],
      shortcuts: [
        {
          target: { kind: 'portal', raycastQuicklinkId: '02A' },
          shortcut: 'Shift+Super+T',
        },
      ],
    });

    const summary = await applyBundle(bundle, ALL);

    expect(summary.shortcuts).toEqual({ added: 1, skipped: 0 });
    const portal = vi.mocked(portalStore.add).mock.calls[0][0];
    expect(shortcutService.register).toHaveBeenCalledWith(
      `cmd_portals_${portal.id}`,
      'Google',
      'command',
      'Shift+Super+T',
      undefined,
      '🔗',
    );
  });

  it('binds quicklink hotkeys to an existing duplicate portal', async () => {
    vi.mocked(portalStore.getAll).mockReturnValue([
      { id: 'existing-id', name: 'Google', url: 'https://g.com/{query}', icon: '🌐', createdAt: 1 },
    ]);
    const bundle = makeBundle({
      portals: [{ raycastId: '02A', name: 'Google', url: 'https://g.com/{query}', icon: '🔗' }],
      shortcuts: [
        { target: { kind: 'portal', raycastQuicklinkId: '02A' }, shortcut: 'Shift+Super+T' },
      ],
    });

    const summary = await applyBundle(bundle, ALL);

    expect(summary.portals).toEqual({ added: 0, skipped: 1 });
    expect(summary.shortcuts).toEqual({ added: 1, skipped: 0 });
    expect(shortcutService.register).toHaveBeenCalledWith(
      'cmd_portals_existing-id',
      'Google',
      'command',
      'Shift+Super+T',
      undefined,
      '🌐',
    );
  });

  it('skips shortcuts whose portal target was not imported', async () => {
    const bundle = makeBundle({
      shortcuts: [
        { target: { kind: 'portal', raycastQuicklinkId: 'missing' }, shortcut: 'Shift+Super+T' },
      ],
    });

    const summary = await applyBundle(bundle, ALL);
    expect(summary.shortcuts).toEqual({ added: 0, skipped: 1 });
    expect(shortcutService.register).not.toHaveBeenCalled();
  });

  it('registers app aliases through aliasService and updates the alias store', async () => {
    const bundle = makeBundle({
      aliases: [
        {
          target: {
            kind: 'app',
            path: '/Applications/iTerm.app',
            objectId: 'app_123',
            itemName: 'iTerm',
          },
          alias: 'it',
        },
      ],
    });

    const summary = await applyBundle(bundle, ALL);

    expect(summary.aliases).toEqual({ added: 1, skipped: 0 });
    expect(aliasService.findConflict).toHaveBeenCalledWith('it', 'app_123');
    expect(aliasService.register).toHaveBeenCalledWith('app_123', 'it', 'iTerm', 'application');
    expect(aliasStore.addOptimistic).toHaveBeenCalledWith({
      objectId: 'app_123',
      alias: 'it',
      itemName: 'iTerm',
      itemType: 'application',
      createdAt: 0,
    });
  });

  it('binds quicklink aliases to the imported portal command', async () => {
    const bundle = makeBundle({
      portals: [{ raycastId: '02A', name: 'Google', url: 'https://g.com/{query}', icon: '🔗' }],
      aliases: [{ target: { kind: 'portal', raycastQuicklinkId: '02A' }, alias: 'gg' }],
    });

    const summary = await applyBundle(bundle, ALL);

    expect(summary.aliases).toEqual({ added: 1, skipped: 0 });
    const portal = vi.mocked(portalStore.add).mock.calls[0][0];
    expect(aliasService.register).toHaveBeenCalledWith(
      `cmd_portals_${portal.id}`,
      'gg',
      'Google',
      'command',
    );
  });

  it('counts conflicting aliases as skipped', async () => {
    vi.mocked(aliasService.findConflict).mockResolvedValue({
      objectId: 'other',
      itemName: 'Other',
    });
    const bundle = makeBundle({
      aliases: [
        { target: { kind: 'app', path: '/a.app', objectId: 'a', itemName: 'A' }, alias: 'aa' },
      ],
    });

    const summary = await applyBundle(bundle, ALL);

    expect(summary.aliases).toEqual({ added: 0, skipped: 1 });
    expect(aliasService.register).not.toHaveBeenCalled();
  });

  it('skips aliases whose target has no resolved object id', async () => {
    const bundle = makeBundle({
      aliases: [{ target: { kind: 'app', path: '/a.app' }, alias: 'aa' }],
    });

    const summary = await applyBundle(bundle, ALL);

    expect(summary.aliases).toEqual({ added: 0, skipped: 1 });
    expect(aliasService.register).not.toHaveBeenCalled();
  });

  it('skips aliases whose portal target was not imported', async () => {
    const bundle = makeBundle({
      aliases: [{ target: { kind: 'portal', raycastQuicklinkId: 'missing' }, alias: 'aa' }],
    });

    const summary = await applyBundle(bundle, ALL);
    expect(summary.aliases).toEqual({ added: 0, skipped: 1 });
    expect(aliasService.register).not.toHaveBeenCalled();
  });

  it('honors the category selection', async () => {
    const bundle = makeBundle({
      snippets: [{ name: 'S', expansion: 'x', pinned: false }],
      portals: [{ name: 'P', url: 'u', icon: '🔗' }],
      shortcuts: [
        {
          target: { kind: 'app', path: '/a.app', objectId: 'a', itemName: 'A' },
          shortcut: 'Super+A',
        },
      ],
      aliases: [
        { target: { kind: 'app', path: '/a.app', objectId: 'a', itemName: 'A' }, alias: 'aa' },
      ],
    });

    const summary = await applyBundle(bundle, {
      snippets: false,
      portals: false,
      shortcuts: false,
      aliases: false,
    });

    expect(summary).toEqual({
      snippets: { added: 0, skipped: 0 },
      portals: { added: 0, skipped: 0 },
      shortcuts: { added: 0, skipped: 0 },
      aliases: { added: 0, skipped: 0 },
    });
    expect(snippetStore.add).not.toHaveBeenCalled();
    expect(portalStore.add).not.toHaveBeenCalled();
    expect(shortcutService.register).not.toHaveBeenCalled();
    expect(aliasService.register).not.toHaveBeenCalled();
  });
});
