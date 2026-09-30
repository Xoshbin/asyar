import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SnippetsSyncProvider } from './snippetsSyncProvider';
import type { SyncProviderData } from '../types';

// Mock the snippetStore
const mockSnippets = [
  {
    id: '1',
    keyword: ';addr',
    expansion: '123 Main St',
    name: 'Address',
    createdAt: 1000,
    pinned: false,
  },
  { id: '2', keyword: ';email', expansion: 'me@example.com', name: 'Email', createdAt: 2000 },
];

vi.mock('../../../built-in-features/snippets/snippetStore.svelte', () => {
  type ChangeCb = (e: { type: 'upsert' | 'delete'; itemId: string }) => void;
  const subscribers = new Set<ChangeCb>();
  return {
    snippetStore: {
      getAll: vi.fn(() => [...mockSnippets]),
      add: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      clearAll: vi.fn(),
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

describe('SnippetsSyncProvider', () => {
  let provider: SnippetsSyncProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new SnippetsSyncProvider();
  });

  it('has correct metadata', () => {
    expect(provider.id).toBe('snippets');
    expect(provider.syncTier).toBe('core');
    expect(provider.defaultEnabled).toBe(true);
    expect(provider.defaultConflictStrategy).toBe('merge');
    expect(provider.sensitiveFields).toEqual([]);
  });

  describe('exportFull', () => {
    it('exports all snippets', async () => {
      const result = await provider.exportFull();
      expect(result.providerId).toBe('snippets');
      expect(result.version).toBe(1);
      expect(result.data).toEqual(mockSnippets);
      expect(result.binaryAssets).toBeUndefined();
    });
  });

  describe('exportForSync', () => {
    it('returns same data as exportFull (no binary data)', async () => {
      const full = await provider.exportFull();
      const sync = await provider.exportForSync();
      expect(sync.data).toEqual(full.data);
    });
  });

  describe('preview', () => {
    it('calculates correct preview stats', async () => {
      const incoming: SyncProviderData = {
        providerId: 'snippets',
        version: 1,
        exportedAt: Date.now(),
        data: [
          {
            id: '1',
            keyword: ';addr',
            expansion: 'Updated Address',
            name: 'Address',
            createdAt: 3000,
          },
          { id: '3', keyword: ';phone', expansion: '555-1234', name: 'Phone', createdAt: 3000 },
        ],
      };

      const preview = await provider.preview(incoming);
      expect(preview.localCount).toBe(2);
      expect(preview.incomingCount).toBe(2);
      expect(preview.conflicts).toBe(1); // id '1' exists in both
      expect(preview.newItems).toBe(1); // id '3' is new
      expect(preview.removedItems).toBe(1); // id '2' only in local
    });
  });

  describe('applyImport', () => {
    it('replaces all items on replace strategy', async () => {
      const { snippetStore } =
        await import('../../../built-in-features/snippets/snippetStore.svelte');
      const incoming: SyncProviderData = {
        providerId: 'snippets',
        version: 1,
        exportedAt: Date.now(),
        data: [{ id: '10', keyword: ';new', expansion: 'new item', name: 'New', createdAt: 5000 }],
      };

      const result = await provider.applyImport(incoming, 'replace');
      expect(snippetStore.clearAll).toHaveBeenCalled();
      expect(snippetStore.add).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.itemsAdded).toBe(1);
    });

    it('merges new items and updates newer ones', async () => {
      const { snippetStore } =
        await import('../../../built-in-features/snippets/snippetStore.svelte');
      const incoming: SyncProviderData = {
        providerId: 'snippets',
        version: 1,
        exportedAt: Date.now(),
        data: [
          { id: '1', keyword: ';addr', expansion: 'Updated', name: 'Address', createdAt: 9999 }, // newer
          {
            id: '2',
            keyword: ';email',
            expansion: 'old@example.com',
            name: 'Email',
            createdAt: 500,
          }, // older
          { id: '3', keyword: ';new', expansion: 'brand new', name: 'New', createdAt: 5000 }, // new
        ],
      };

      const result = await provider.applyImport(incoming, 'merge');
      expect(snippetStore.add).toHaveBeenCalledTimes(1); // id '3'
      expect(snippetStore.update).toHaveBeenCalledTimes(1); // id '1' (newer)
      expect(result.itemsAdded).toBe(1);
      expect(result.itemsUpdated).toBe(1);
    });

    it('does nothing on skip strategy', async () => {
      const incoming: SyncProviderData = {
        providerId: 'snippets',
        version: 1,
        exportedAt: Date.now(),
        data: [{ id: '99', keyword: ';x', expansion: 'x', name: 'X', createdAt: 1 }],
      };

      const result = await provider.applyImport(incoming, 'skip');
      expect(result.itemsAdded).toBe(0);
      expect(result.itemsUpdated).toBe(0);
    });
  });

  describe('getLocalSummary', () => {
    it('returns correct count and label', async () => {
      const summary = await provider.getLocalSummary();
      expect(summary.itemCount).toBe(2);
      expect(summary.label).toBe('2 snippets');
    });
  });

  describe('exportItems returns one SyncItem per snippet', () => {
    it('one entry per snippet keyed by id', async () => {
      const items = await provider.exportItems();
      expect(items.length).toBe(2);
      expect(items[0].id).toBe('1');
      expect(items[0].categoryId).toBe('snippets');
      expect(items[1].id).toBe('2');
    });
  });

  describe('applyItemUpsert routes to snippetStore.add', () => {
    it('adds the snippet content via the store', async () => {
      const { snippetStore } =
        await import('../../../built-in-features/snippets/snippetStore.svelte');
      const content = { id: '99', keyword: ';n', expansion: 'new', name: 'New', createdAt: 9000 };
      await provider.applyItemUpsert({ id: '99', categoryId: 'snippets', content });
      expect(snippetStore.add).toHaveBeenCalledWith(content);
    });
  });

  describe('applyItemDelete routes to snippetStore.remove', () => {
    it('removes the snippet by id', async () => {
      const { snippetStore } =
        await import('../../../built-in-features/snippets/snippetStore.svelte');
      await provider.applyItemDelete('1');
      expect(snippetStore.remove).toHaveBeenCalledWith('1');
    });
  });

  describe('subscribeToChanges propagates store events', () => {
    it('fires upsert/delete from store events with categoryId attached', async () => {
      const events: Array<{ type: string; itemId: string; categoryId: string }> = [];
      const unsub = provider.subscribeToChanges((ev) => events.push(ev));

      const { snippetStore } =
        await import('../../../built-in-features/snippets/snippetStore.svelte');
      const emit = (
        snippetStore as unknown as {
          __emit: (e: { type: 'upsert' | 'delete'; itemId: string; isPrivate?: boolean }) => void;
        }
      ).__emit;
      emit({ type: 'upsert', itemId: '1' });
      emit({ type: 'delete', itemId: '2' });

      expect(events).toEqual([
        { type: 'upsert', itemId: '1', categoryId: 'snippets' },
        { type: 'delete', itemId: '2', categoryId: 'snippets' },
      ]);
      unsub();
    });

    it('suppresses sync change events and tombstones for private snippets', async () => {
      const events: Array<{ type: string; itemId: string; categoryId: string }> = [];
      const unsub = provider.subscribeToChanges((ev) => events.push(ev));

      const { snippetStore } =
        await import('../../../built-in-features/snippets/snippetStore.svelte');
      const emit = (
        snippetStore as unknown as {
          __emit: (e: { type: 'upsert' | 'delete'; itemId: string; isPrivate?: boolean }) => void;
        }
      ).__emit;
      emit({ type: 'upsert', itemId: 'priv-1', isPrivate: true });
      emit({ type: 'delete', itemId: 'priv-2', isPrivate: true });

      expect(events).toEqual([]);
      unsub();
    });
  });

  describe('private snippet local-only sync opt-out', () => {
    it('exportForSync omits private snippets', async () => {
      const { snippetStore } =
        await import('../../../built-in-features/snippets/snippetStore.svelte');
      vi.mocked(snippetStore.getAll).mockReturnValueOnce([
        {
          id: '1',
          keyword: ';pub',
          expansion: 'Public',
          name: 'Pub',
          createdAt: 1000,
          isPrivate: false,
        },
        {
          id: '2',
          keyword: ';priv',
          expansion: 'Secret',
          name: 'Priv',
          createdAt: 2000,
          isPrivate: true,
        },
      ]);

      const sync = await provider.exportForSync();
      const items = sync.data as Array<{ id: string; isPrivate?: boolean }>;
      expect(items.length).toBe(1);
      expect(items[0].id).toBe('1');
    });

    it('exportItems omits private snippets from cloud delta sync', async () => {
      const { snippetStore } =
        await import('../../../built-in-features/snippets/snippetStore.svelte');
      vi.mocked(snippetStore.getAll).mockReturnValueOnce([
        {
          id: '1',
          keyword: ';pub',
          expansion: 'Public',
          name: 'Pub',
          createdAt: 1000,
          isPrivate: false,
        },
        {
          id: '2',
          keyword: ';priv',
          expansion: 'Secret',
          name: 'Priv',
          createdAt: 2000,
          isPrivate: true,
        },
      ]);

      const items = await provider.exportItems();
      expect(items.length).toBe(1);
      expect(items[0].id).toBe('1');
    });

    it('applyItemUpsert does not overwrite existing local private snippet', async () => {
      const { snippetStore } =
        await import('../../../built-in-features/snippets/snippetStore.svelte');
      vi.mocked(snippetStore.getAll).mockReturnValueOnce([
        {
          id: 'priv-1',
          keyword: ';priv',
          expansion: 'Local Secret',
          name: 'Priv',
          createdAt: 1000,
          isPrivate: true,
        },
      ]);

      await provider.applyItemUpsert({
        id: 'priv-1',
        categoryId: 'snippets',
        content: {
          id: 'priv-1',
          keyword: ';priv',
          expansion: 'Remote Overwrite',
          name: 'Priv',
          createdAt: 2000,
        },
      });

      expect(snippetStore.add).not.toHaveBeenCalled();
    });

    it('applyItemDelete does not remove local private snippet', async () => {
      const { snippetStore } =
        await import('../../../built-in-features/snippets/snippetStore.svelte');
      vi.mocked(snippetStore.getAll).mockReturnValueOnce([
        {
          id: 'priv-1',
          keyword: ';priv',
          expansion: 'Local Secret',
          name: 'Priv',
          createdAt: 1000,
          isPrivate: true,
        },
      ]);

      await provider.applyItemDelete('priv-1');
      expect(snippetStore.remove).not.toHaveBeenCalled();
    });

    it('applyImport preserves local private snippets when replace strategy is used', async () => {
      const { snippetStore } =
        await import('../../../built-in-features/snippets/snippetStore.svelte');
      vi.mocked(snippetStore.getAll).mockReturnValueOnce([
        {
          id: 'priv-1',
          keyword: ';priv',
          expansion: 'Keep Me',
          name: 'Priv',
          createdAt: 1000,
          isPrivate: true,
        },
      ]);

      const incoming: SyncProviderData = {
        providerId: 'snippets',
        version: 1,
        exportedAt: Date.now(),
        data: [
          { id: 'pub-2', keyword: ';pub', expansion: 'New Item', name: 'Pub', createdAt: 2000 },
        ],
      };

      await provider.applyImport(incoming, 'replace');
      expect(snippetStore.clearAll).toHaveBeenCalled();
      // Should add incoming item AND preserve private item
      expect(snippetStore.add).toHaveBeenCalledWith(expect.objectContaining({ id: 'pub-2' }));
      expect(snippetStore.add).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'priv-1', isPrivate: true }),
      );
    });
  });
});
