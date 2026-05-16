import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/ipc/commands', () => ({
  clipboardExportForSync: vi.fn(),
  clipboardCount: vi.fn(),
}));

vi.mock('../../clipboard/stores/clipboardHistoryStore.svelte', () => ({
  clipboardHistoryStore: {
    addHistoryItem: vi.fn(),
    deleteHistoryItem: vi.fn(),
    clearHistory: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  },
}));

import { ClipboardSyncProvider } from './clipboardSyncProvider';
import {
  clipboardExportForSync,
  clipboardCount,
  type StoredClipboardItem,
} from '../../../lib/ipc/commands';
import type { SyncProviderData } from '../types';

const mockExport = clipboardExportForSync as unknown as ReturnType<typeof vi.fn>;
const mockCount = clipboardCount as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => { vi.clearAllMocks(); });

// ── Paged export ─────────────────────────────────────────────────────────────

describe('ClipboardSyncProvider — paged export', () => {
  it('exportItems iterates every row across multiple pages without holding all rows at once', async () => {
    const allRows: StoredClipboardItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`, type: 'text', content: `body ${i}`, preview: `body ${i}`,
      createdAt: 1000 + i, favorite: false,
    }));
    let call = 0;
    mockExport.mockImplementation(async (cursor: unknown, limit: number) => {
      const pageStart = call * limit;
      call++;
      const slice = allRows.slice(pageStart, pageStart + limit);
      const nextCursor = (pageStart + limit) < allRows.length
        ? { createdAt: slice[slice.length - 1].createdAt, id: slice[slice.length - 1].id }
        : undefined;
      return { items: slice, nextCursor };
    });

    const provider = new ClipboardSyncProvider();
    const items = await provider.exportItems();
    expect(items.map((i: any) => i.id).sort()).toEqual(allRows.map((r) => r.id).sort());
    expect(mockExport).toHaveBeenCalled();
    expect(mockExport.mock.calls[0][1]).toBeGreaterThan(0); // limit > 0
  });

  it('exportItems issues multiple pages when the dataset is larger than the page size', async () => {
    const allRows: StoredClipboardItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`, type: 'text', content: `c${i}`, preview: `c${i}`,
      createdAt: 1000 + i, favorite: false,
    }));
    let call = 0;
    mockExport.mockImplementation(async () => {
      const pageSize = 2;
      const start = call * pageSize;
      call++;
      const slice = allRows.slice(start, start + pageSize);
      const nextCursor = (start + pageSize) < allRows.length
        ? { createdAt: slice[slice.length - 1].createdAt, id: slice[slice.length - 1].id }
        : undefined;
      return { items: slice, nextCursor };
    });

    const provider = new ClipboardSyncProvider();
    const items = await provider.exportItems();
    expect(items.map((i: any) => i.id).sort()).toEqual(allRows.map((r) => r.id).sort());
    expect(call).toBe(3); // 2 + 2 + 1
  });

  it('getLocalSummary uses clipboardCount (no full list)', async () => {
    mockCount.mockResolvedValue({ total: 12345, favorites: 99 });
    const provider = new ClipboardSyncProvider();
    const summary = await provider.getLocalSummary();
    expect(summary.itemCount).toBe(12345);
    expect(mockExport).not.toHaveBeenCalled();
  });
});

// ── Metadata ──────────────────────────────────────────────────────────────────

describe('ClipboardSyncProvider — metadata', () => {
  it('has correct metadata', () => {
    const provider = new ClipboardSyncProvider();
    expect(provider.id).toBe('clipboard');
    expect(provider.syncTier).toBe('core');
    expect(provider.defaultEnabled).toBe(true);
    expect(provider.defaultConflictStrategy).toBe('merge');
    expect(provider.sensitiveFields).toEqual([]);
  });
});

// ── exportFull ────────────────────────────────────────────────────────────────

describe('ClipboardSyncProvider — exportFull', () => {
  it('includes binary asset for image items', async () => {
    mockExport.mockResolvedValueOnce({
      items: [
        { id: 'c1', type: 'text', content: 'Hello World', createdAt: 1000, favorite: false },
        { id: 'c2', type: 'image', createdAt: 2000, favorite: false },
      ],
      nextCursor: undefined,
    });

    const provider = new ClipboardSyncProvider();
    const result = await provider.exportFull();
    expect(result.providerId).toBe('clipboard');
    expect(result.version).toBe(1);
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.binaryAssets).toBeDefined();
    expect(result.binaryAssets!.length).toBe(1);
    expect(result.binaryAssets![0].id).toBe('c2');
    expect(result.binaryAssets![0].filename).toBe('c2.png');
    expect(result.binaryAssets![0].mimeType).toBe('image/png');
    expect(result.binaryAssets![0].archivePath).toBe('assets/clipboard/c2.png');
  });

  it('preserves raw HTML content unchanged', async () => {
    mockExport.mockResolvedValueOnce({
      items: [
        { id: 'h2', type: 'html', content: '<p>Hello <b>world</b></p>', createdAt: 1000, favorite: false },
      ],
      nextCursor: undefined,
    });

    const provider = new ClipboardSyncProvider();
    const result = await provider.exportFull();
    const data = result.data as any[];
    expect(data[0].content).toBe('<p>Hello <b>world</b></p>');
    expect(data[0].type).toBe('html');
  });
});

// ── exportForSync ─────────────────────────────────────────────────────────────

describe('ClipboardSyncProvider — exportForSync', () => {
  it('excludes image items', async () => {
    mockExport.mockResolvedValueOnce({
      items: [
        { id: 'c1', type: 'text', content: 'Hello World', createdAt: 1000, favorite: false },
        { id: 'c2', type: 'image', createdAt: 2000, favorite: false },
      ],
      nextCursor: undefined,
    });

    const provider = new ClipboardSyncProvider();
    const result = await provider.exportForSync();
    const data = result.data as any[];
    expect(data.length).toBe(1);
    expect(data[0].id).toBe('c1');
    expect(result.binaryAssets).toBeUndefined();
  });

  it('strips HTML tags from html items and downgrades type to text', async () => {
    mockExport.mockResolvedValueOnce({
      items: [
        { id: 'h1', type: 'html', content: '<p>Hello <b>world</b></p>', preview: 'Hello world', createdAt: 1000, favorite: false },
      ],
      nextCursor: undefined,
    });

    const provider = new ClipboardSyncProvider();
    const result = await provider.exportForSync();
    const data = result.data as any[];
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('h1');
    expect(data[0].content).toBe('Hello world');
    expect(data[0].type).toBe('text');
  });

  it('strips RTF markup from rtf items and downgrades type to text', async () => {
    mockExport.mockResolvedValueOnce({
      items: [
        { id: 'r1', type: 'rtf', content: '{\\rtf1 visible text}', preview: 'visible text', createdAt: 1000, favorite: false },
      ],
      nextCursor: undefined,
    });

    const provider = new ClipboardSyncProvider();
    const result = await provider.exportForSync();
    const data = result.data as any[];
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('r1');
    expect(data[0].content).toBe('visible text');
    expect(data[0].type).toBe('text');
  });

  it('leaves text items unchanged', async () => {
    mockExport.mockResolvedValueOnce({
      items: [
        { id: 't1', type: 'text', content: 'plain text', createdAt: 1000, favorite: false },
      ],
      nextCursor: undefined,
    });

    const provider = new ClipboardSyncProvider();
    const result = await provider.exportForSync();
    const data = result.data as any[];
    expect(data[0].content).toBe('plain text');
    expect(data[0].type).toBe('text');
  });
});

// ── preview ───────────────────────────────────────────────────────────────────

describe('ClipboardSyncProvider — preview', () => {
  it('calculates correct stats', async () => {
    mockCount.mockResolvedValue({ total: 2, favorites: 0 });
    mockExport.mockResolvedValueOnce({
      items: [
        { id: 'c1', type: 'text', content: 'Hello World', createdAt: 1000, favorite: false },
        { id: 'c2', type: 'image', createdAt: 2000, favorite: false },
      ],
      nextCursor: undefined,
    });

    const incoming: SyncProviderData = {
      providerId: 'clipboard',
      version: 1,
      exportedAt: Date.now(),
      data: [
        { id: 'c1', type: 'text', content: 'Hello World', createdAt: 1000, favorite: false },
        { id: 'c3', type: 'text', content: 'New Item', createdAt: 3000, favorite: false },
      ],
    };

    const provider = new ClipboardSyncProvider();
    const preview = await provider.preview(incoming);
    expect(preview.localCount).toBe(2);
    expect(preview.incomingCount).toBe(2);
    expect(preview.conflicts).toBe(1);  // c1 exists in both
    expect(preview.newItems).toBe(1);   // c3 is new
    expect(preview.removedItems).toBe(1); // c2 only in local
  });
});

// ── applyImport ───────────────────────────────────────────────────────────────

describe('ClipboardSyncProvider — applyImport', () => {
  it('replace — calls clearHistory and addHistoryItem for each', async () => {
    const { clipboardHistoryStore } = await import('../../clipboard/stores/clipboardHistoryStore.svelte');
    const incoming: SyncProviderData = {
      providerId: 'clipboard',
      version: 1,
      exportedAt: Date.now(),
      data: [
        { id: 'c10', type: 'text', content: 'New item', createdAt: 5000, favorite: false },
      ],
    };

    const provider = new ClipboardSyncProvider();
    const result = await provider.applyImport(incoming, 'replace');
    expect(clipboardHistoryStore.clearHistory).toHaveBeenCalled();
    expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.itemsAdded).toBe(1);
  });

  it('merge — adds only new items (by id)', async () => {
    mockExport.mockResolvedValueOnce({
      items: [
        { id: 'c1', type: 'text', content: 'Hello World', createdAt: 1000, favorite: false },
        { id: 'c2', type: 'image', createdAt: 2000, favorite: false },
      ],
      nextCursor: undefined,
    });

    const { clipboardHistoryStore } = await import('../../clipboard/stores/clipboardHistoryStore.svelte');
    const incoming: SyncProviderData = {
      providerId: 'clipboard',
      version: 1,
      exportedAt: Date.now(),
      data: [
        { id: 'c1', type: 'text', content: 'Hello World', createdAt: 1000, favorite: false },
        { id: 'c3', type: 'text', content: 'New Item', createdAt: 3000, favorite: false },
      ],
    };

    const provider = new ClipboardSyncProvider();
    const result = await provider.applyImport(incoming, 'merge');
    expect(clipboardHistoryStore.clearHistory).not.toHaveBeenCalled();
    expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledTimes(1);
    expect(result.itemsAdded).toBe(1);
  });

  it('skip — does nothing', async () => {
    const { clipboardHistoryStore } = await import('../../clipboard/stores/clipboardHistoryStore.svelte');
    const incoming: SyncProviderData = {
      providerId: 'clipboard',
      version: 1,
      exportedAt: Date.now(),
      data: [{ id: 'c99', type: 'text', content: 'X', createdAt: 1, favorite: false }],
    };

    const provider = new ClipboardSyncProvider();
    const result = await provider.applyImport(incoming, 'skip');
    expect(clipboardHistoryStore.clearHistory).not.toHaveBeenCalled();
    expect(clipboardHistoryStore.addHistoryItem).not.toHaveBeenCalled();
    expect(result.itemsAdded).toBe(0);
    expect(result.itemsUpdated).toBe(0);
  });
});

// ── Delta sync surface ────────────────────────────────────────────────────────

describe('ClipboardSyncProvider — delta sync surface', () => {
  it('exportItems returns one SyncItem per non-image clipboard entry', async () => {
    mockExport.mockResolvedValueOnce({
      items: [
        { id: 'c1', type: 'text', content: 'Hello World', createdAt: 1000, favorite: false },
        { id: 'c2', type: 'image', createdAt: 2000, favorite: false },
      ],
      nextCursor: undefined,
    });

    const provider = new ClipboardSyncProvider();
    const items = await provider.exportItems();
    expect(items.length).toBe(1);
    expect(items[0].id).toBe('c1');
    expect(items[0].categoryId).toBe('clipboard');
  });

  it('applyItemUpsert routes to addHistoryItem with the content', async () => {
    const { clipboardHistoryStore } = await import('../../clipboard/stores/clipboardHistoryStore.svelte');
    const content = { id: 'c10', type: 'text', content: 'Hello', createdAt: 5000, favorite: false };
    const provider = new ClipboardSyncProvider();
    await provider.applyItemUpsert({ id: 'c10', categoryId: 'clipboard', content });
    expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledWith(content);
  });

  it('applyItemDelete routes to deleteHistoryItem with the id', async () => {
    const { clipboardHistoryStore } = await import('../../clipboard/stores/clipboardHistoryStore.svelte');
    const provider = new ClipboardSyncProvider();
    await provider.applyItemDelete('c1');
    expect(clipboardHistoryStore.deleteHistoryItem).toHaveBeenCalledWith('c1');
  });

  it('subscribeToChanges fires when the store emits an upsert', async () => {
    // Re-wire the subscribe mock to support __emit for this test
    const { clipboardHistoryStore } = await import('../../clipboard/stores/clipboardHistoryStore.svelte');
    type ChangeCb = (event: { type: 'upsert' | 'delete'; itemId: string }) => void;
    const subscribers = new Set<ChangeCb>();
    vi.mocked(clipboardHistoryStore.subscribe).mockImplementation((cb: ChangeCb) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    });

    const provider = new ClipboardSyncProvider();
    const events: Array<{ type: string; itemId: string; categoryId: string }> = [];
    const unsub = provider.subscribeToChanges((ev) => events.push(ev));

    subscribers.forEach((cb) => cb({ type: 'upsert', itemId: 'c5' }));

    expect(events.length).toBe(1);
    expect(events[0]).toEqual({ type: 'upsert', itemId: 'c5', categoryId: 'clipboard' });
    unsub();
  });

  it('subscribeToChanges propagates delete events', async () => {
    const { clipboardHistoryStore } = await import('../../clipboard/stores/clipboardHistoryStore.svelte');
    type ChangeCb = (event: { type: 'upsert' | 'delete'; itemId: string }) => void;
    const subscribers = new Set<ChangeCb>();
    vi.mocked(clipboardHistoryStore.subscribe).mockImplementation((cb: ChangeCb) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    });

    const provider = new ClipboardSyncProvider();
    const events: Array<{ type: string; itemId: string; categoryId: string }> = [];
    const unsub = provider.subscribeToChanges((ev) => events.push(ev));

    subscribers.forEach((cb) => cb({ type: 'delete', itemId: 'c1' }));

    expect(events).toEqual([{ type: 'delete', itemId: 'c1', categoryId: 'clipboard' }]);
    unsub();
  });
});
