import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShortcutsSyncProvider } from './shortcutsSyncProvider';
import type { SyncProviderData } from '../types';

const mockShortcuts = [
  {
    id: '1',
    objectId: 'app-safari',
    itemName: 'Safari',
    itemType: 'application' as const,
    shortcut: 'ctrl+1',
    createdAt: 1000,
  },
  {
    id: '2',
    objectId: 'app-chrome',
    itemName: 'Chrome',
    itemType: 'application' as const,
    shortcut: 'ctrl+2',
    createdAt: 2000,
  },
];

vi.mock('../../../built-in-features/shortcuts/shortcutStore.svelte', () => {
  type ChangeCb = (e: { type: 'upsert' | 'delete'; itemId: string }) => void;
  const subscribers = new Set<ChangeCb>();
  return {
    shortcutStore: {
      getAll: vi.fn(() => [...mockShortcuts]),
      add: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      subscribe: vi.fn((cb: ChangeCb) => {
        subscribers.add(cb);
        return () => subscribers.delete(cb);
      }),
      __emit: (ev: { type: 'upsert' | 'delete'; itemId: string }) => {
        subscribers.forEach((cb) => cb(ev));
      },
    },
  };
});

vi.mock('../../../lib/ipc/syncCommands', () => ({
  syncMarkTombstone: vi.fn().mockResolvedValue(undefined),
}));

describe('ShortcutsSyncProvider', () => {
  let provider: ShortcutsSyncProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new ShortcutsSyncProvider();
  });

  it('has correct metadata', () => {
    expect(provider.id).toBe('shortcuts');
    expect(provider.syncTier).toBe('core');
    expect(provider.defaultEnabled).toBe(true);
    expect(provider.defaultConflictStrategy).toBe('merge');
    expect(provider.sensitiveFields).toEqual([]);
  });

  describe('exportFull', () => {
    it('exports all shortcuts', async () => {
      const result = await provider.exportFull();
      expect(result.providerId).toBe('shortcuts');
      expect(result.version).toBe(1);
      expect(result.data).toEqual(mockShortcuts);
      expect(result.binaryAssets).toBeUndefined();
    });
  });

  describe('exportForSync', () => {
    it('returns same data as exportFull', async () => {
      const full = await provider.exportFull();
      const sync = await provider.exportForSync();
      expect(sync.data).toEqual(full.data);
    });
  });

  describe('preview', () => {
    it('calculates correct preview stats', async () => {
      const incoming: SyncProviderData = {
        providerId: 'shortcuts',
        version: 1,
        exportedAt: Date.now(),
        data: [
          {
            id: '3',
            objectId: 'app-safari',
            itemName: 'Safari',
            itemType: 'application',
            shortcut: 'ctrl+1',
            createdAt: 3000,
          }, // conflict
          {
            id: '4',
            objectId: 'app-firefox',
            itemName: 'Firefox',
            itemType: 'application',
            shortcut: 'ctrl+3',
            createdAt: 3000,
          }, // new
        ],
      };

      const preview = await provider.preview(incoming);
      expect(preview.localCount).toBe(2);
      expect(preview.incomingCount).toBe(2);
      expect(preview.conflicts).toBe(1); // app-safari exists in both
      expect(preview.newItems).toBe(1); // app-firefox is new
      expect(preview.removedItems).toBe(1); // app-chrome only in local
    });
  });

  describe('applyImport', () => {
    it('replace — removes all existing and adds incoming', async () => {
      const { shortcutStore } =
        await import('../../../built-in-features/shortcuts/shortcutStore.svelte');
      const incoming: SyncProviderData = {
        providerId: 'shortcuts',
        version: 1,
        exportedAt: Date.now(),
        data: [
          {
            id: '10',
            objectId: 'app-vscode',
            itemName: 'VSCode',
            itemType: 'application',
            shortcut: 'ctrl+0',
            createdAt: 5000,
          },
        ],
      };

      const result = await provider.applyImport(incoming, 'replace');
      expect(shortcutStore.remove).toHaveBeenCalledTimes(2); // removes existing 2
      expect(shortcutStore.add).toHaveBeenCalledTimes(1); // adds 1 incoming
      expect(result.success).toBe(true);
      expect(result.itemsAdded).toBe(1);
      expect(result.itemsRemoved).toBe(2);
    });

    it('merge — adds new, updates newer, skips older', async () => {
      const { shortcutStore } =
        await import('../../../built-in-features/shortcuts/shortcutStore.svelte');
      const incoming: SyncProviderData = {
        providerId: 'shortcuts',
        version: 1,
        exportedAt: Date.now(),
        data: [
          {
            id: '1',
            objectId: 'app-safari',
            itemName: 'Safari',
            itemType: 'application',
            shortcut: 'ctrl+1',
            createdAt: 9999,
          }, // newer → update
          {
            id: '2',
            objectId: 'app-chrome',
            itemName: 'Chrome',
            itemType: 'application',
            shortcut: 'ctrl+2',
            createdAt: 500,
          }, // older → skip
          {
            id: '5',
            objectId: 'app-firefox',
            itemName: 'Firefox',
            itemType: 'application',
            shortcut: 'ctrl+3',
            createdAt: 5000,
          }, // new → add
        ],
      };

      const result = await provider.applyImport(incoming, 'merge');
      expect(shortcutStore.add).toHaveBeenCalledTimes(1); // app-firefox
      expect(shortcutStore.update).toHaveBeenCalledTimes(1); // app-safari (newer)
      expect(result.itemsAdded).toBe(1);
      expect(result.itemsUpdated).toBe(1);
    });

    it('skip — does nothing', async () => {
      const { shortcutStore } =
        await import('../../../built-in-features/shortcuts/shortcutStore.svelte');
      const incoming: SyncProviderData = {
        providerId: 'shortcuts',
        version: 1,
        exportedAt: Date.now(),
        data: [
          {
            id: '99',
            objectId: 'app-x',
            itemName: 'X',
            itemType: 'application',
            shortcut: 'ctrl+x',
            createdAt: 1,
          },
        ],
      };

      const result = await provider.applyImport(incoming, 'skip');
      expect(shortcutStore.add).not.toHaveBeenCalled();
      expect(shortcutStore.update).not.toHaveBeenCalled();
      expect(shortcutStore.remove).not.toHaveBeenCalled();
      expect(result.itemsAdded).toBe(0);
      expect(result.itemsUpdated).toBe(0);
    });
  });

  describe('getLocalSummary', () => {
    it('returns correct count and label', async () => {
      const summary = await provider.getLocalSummary();
      expect(summary.itemCount).toBe(2);
      expect(summary.label).toBe('2 shortcuts');
    });
  });

  describe('exportItems returns one SyncItem per shortcut keyed by objectId', () => {
    it('one entry per shortcut', async () => {
      const items = await provider.exportItems();
      expect(items.length).toBe(2);
      expect(items[0].id).toBe('app-safari');
      expect(items[0].categoryId).toBe('shortcuts');
      expect(items[1].id).toBe('app-chrome');
    });
  });

  describe('applyItemUpsert routes to shortcutStore.add', () => {
    it('adds the shortcut content', async () => {
      const { shortcutStore } =
        await import('../../../built-in-features/shortcuts/shortcutStore.svelte');
      const content = {
        id: '99',
        objectId: 'app-x',
        itemName: 'X',
        itemType: 'application',
        shortcut: 'ctrl+x',
        createdAt: 9000,
      };
      await provider.applyItemUpsert({ id: 'app-x', categoryId: 'shortcuts', content });
      expect(shortcutStore.add).toHaveBeenCalledWith(content);
    });
  });

  describe('applyItemUpsert enforces one chord per item', () => {
    const row = (objectId: string, shortcut: string, createdAt: number) => ({
      id: objectId,
      objectId,
      itemName: 'Grammar Fix',
      itemType: 'command' as const,
      shortcut,
      createdAt,
    });

    async function mocks() {
      const { shortcutStore } =
        await import('../../../built-in-features/shortcuts/shortcutStore.svelte');
      const { syncMarkTombstone } = await import('../../../lib/ipc/syncCommands');
      return { shortcutStore, syncMarkTombstone };
    }

    it('drops an older incoming row that collides with a local chord and tombstones it', async () => {
      const { shortcutStore, syncMarkTombstone } = await mocks();
      vi.mocked(shortcutStore.getAll).mockReturnValue([
        row('cmd_agents_dyn_live', 'Super+Shift+L', 5000),
      ] as any);
      const orphan = row('cmd_agents_dyn_dead', 'Shift+Super+L', 1000);

      await provider.applyItemUpsert({
        id: orphan.objectId,
        categoryId: 'shortcuts',
        content: orphan,
      });

      expect(shortcutStore.add).not.toHaveBeenCalled();
      expect(syncMarkTombstone).toHaveBeenCalledWith('cmd_agents_dyn_dead', 'shortcuts');
    });

    it('replaces an older local row when the incoming one is newer', async () => {
      const { shortcutStore, syncMarkTombstone } = await mocks();
      vi.mocked(shortcutStore.getAll).mockReturnValue([
        row('cmd_agents_dyn_old', 'Super+Shift+L', 1000),
      ] as any);
      const incoming = row('cmd_agents_dyn_new', 'Super+Shift+L', 9000);

      await provider.applyItemUpsert({
        id: incoming.objectId,
        categoryId: 'shortcuts',
        content: incoming,
      });

      expect(shortcutStore.remove).toHaveBeenCalledWith('cmd_agents_dyn_old');
      expect(syncMarkTombstone).toHaveBeenCalledWith('cmd_agents_dyn_old', 'shortcuts');
      expect(shortcutStore.add).toHaveBeenCalledWith(incoming);
    });

    it('still updates the same object in place (same objectId is not a collision)', async () => {
      const { shortcutStore, syncMarkTombstone } = await mocks();
      vi.mocked(shortcutStore.getAll).mockReturnValue([
        row('cmd_agents_dyn_a', 'Super+Shift+L', 1000),
      ] as any);
      const same = row('cmd_agents_dyn_a', 'Super+Shift+L', 2000);

      await provider.applyItemUpsert({ id: same.objectId, categoryId: 'shortcuts', content: same });

      expect(shortcutStore.add).toHaveBeenCalledWith(same);
      expect(syncMarkTombstone).not.toHaveBeenCalled();
    });

    it('restore path: 12 stale rows pulled after onboarding leave exactly one holder of the chord', async () => {
      const { shortcutStore } = await mocks();
      let local: any[] = [row('cmd_agents_dyn_live', 'Super+Shift+L', 9000)];
      vi.mocked(shortcutStore.getAll).mockImplementation(() => [...local]);
      vi.mocked(shortcutStore.add).mockImplementation((s: any) => {
        local = [...local.filter((x) => x.objectId !== s.objectId), s];
      });
      vi.mocked(shortcutStore.remove).mockImplementation((id: string) => {
        local = local.filter((x) => x.objectId !== id);
      });

      for (let i = 0; i < 12; i++) {
        const stale = row(`cmd_agents_dyn_stale${i}`, 'Super+Shift+L', 1000 + i);
        await provider.applyItemUpsert({
          id: stale.objectId,
          categoryId: 'shortcuts',
          content: stale,
        });
      }

      expect(local.map((s) => s.objectId)).toEqual(['cmd_agents_dyn_live']);
    });
  });

  describe('applyItemDelete routes to shortcutStore.remove', () => {
    it('removes the shortcut by objectId', async () => {
      const { shortcutStore } =
        await import('../../../built-in-features/shortcuts/shortcutStore.svelte');
      await provider.applyItemDelete('app-safari');
      expect(shortcutStore.remove).toHaveBeenCalledWith('app-safari');
    });
  });

  describe('subscribeToChanges propagates store events', () => {
    it('relays upsert and delete events with categoryId', async () => {
      const events: Array<{ type: string; itemId: string; categoryId: string }> = [];
      const unsub = provider.subscribeToChanges((ev) => events.push(ev));
      const { shortcutStore } =
        await import('../../../built-in-features/shortcuts/shortcutStore.svelte');
      const emit = (
        shortcutStore as unknown as {
          __emit: (e: { type: 'upsert' | 'delete'; itemId: string }) => void;
        }
      ).__emit;
      emit({ type: 'upsert', itemId: 'app-safari' });
      emit({ type: 'delete', itemId: 'app-chrome' });

      expect(events).toEqual([
        { type: 'upsert', itemId: 'app-safari', categoryId: 'shortcuts' },
        { type: 'delete', itemId: 'app-chrome', categoryId: 'shortcuts' },
      ]);
      unsub();
    });
  });
});
