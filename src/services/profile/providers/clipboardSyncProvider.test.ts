import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClipboardSyncProvider } from './clipboardSyncProvider';
import type { SyncProviderData } from '../types';

const mockItems = [
  { id: 'c1', type: 'text', content: 'Hello World', createdAt: 1000, favorite: false },
  { id: 'c2', type: 'image', createdAt: 2000, favorite: false },
];

vi.mock('../../clipboard/stores/clipboardHistoryStore.svelte', () => {
  type ChangeCb = (event: { type: 'upsert' | 'delete'; itemId: string }) => void;
  const subscribers = new Set<ChangeCb>();
  return {
    clipboardHistoryStore: {
      getHistoryItems: vi.fn().mockResolvedValue([
        { id: 'c1', type: 'text', content: 'Hello World', createdAt: 1000, favorite: false },
        { id: 'c2', type: 'image', createdAt: 2000, favorite: false },
      ]),
      addHistoryItem: vi.fn().mockResolvedValue(undefined),
      clearHistory: vi.fn().mockResolvedValue(undefined),
      deleteHistoryItem: vi.fn().mockResolvedValue(undefined),
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

describe('ClipboardSyncProvider', () => {
  let provider: ClipboardSyncProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new ClipboardSyncProvider();
  });

  it('has correct metadata', () => {
    expect(provider.id).toBe('clipboard');
    expect(provider.syncTier).toBe('core');
    expect(provider.defaultEnabled).toBe(true);
    expect(provider.defaultConflictStrategy).toBe('merge');
    expect(provider.sensitiveFields).toEqual([]);
  });

  it('exportFull includes binary asset for image items', async () => {
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

  it('exportForSync excludes image items', async () => {
    const result = await provider.exportForSync();
    const data = result.data as any[];
    expect(data.length).toBe(1);
    expect(data[0].id).toBe('c1');
    expect(result.binaryAssets).toBeUndefined();
  });

  it('preview calculates correct stats', async () => {
    const incoming: SyncProviderData = {
      providerId: 'clipboard',
      version: 1,
      exportedAt: Date.now(),
      data: [
        { id: 'c1', type: 'text', content: 'Hello World', createdAt: 1000, favorite: false },
        { id: 'c3', type: 'text', content: 'New Item', createdAt: 3000, favorite: false },
      ],
    };

    const preview = await provider.preview(incoming);
    expect(preview.localCount).toBe(2);
    expect(preview.incomingCount).toBe(2);
    expect(preview.conflicts).toBe(1); // c1 exists in both
    expect(preview.newItems).toBe(1);  // c3 is new
    expect(preview.removedItems).toBe(1); // c2 only in local
  });

  it('applyImport replace — calls clearHistory and addHistoryItem for each', async () => {
    const { clipboardHistoryStore } = await import('../../clipboard/stores/clipboardHistoryStore.svelte');
    const incoming: SyncProviderData = {
      providerId: 'clipboard',
      version: 1,
      exportedAt: Date.now(),
      data: [
        { id: 'c10', type: 'text', content: 'New item', createdAt: 5000, favorite: false },
      ],
    };

    const result = await provider.applyImport(incoming, 'replace');
    expect(clipboardHistoryStore.clearHistory).toHaveBeenCalled();
    expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.itemsAdded).toBe(1);
  });

  it('applyImport merge — adds only new items (by id)', async () => {
    const { clipboardHistoryStore } = await import('../../clipboard/stores/clipboardHistoryStore.svelte');
    const incoming: SyncProviderData = {
      providerId: 'clipboard',
      version: 1,
      exportedAt: Date.now(),
      data: [
        { id: 'c1', type: 'text', content: 'Hello World', createdAt: 1000, favorite: false }, // existing
        { id: 'c3', type: 'text', content: 'New Item', createdAt: 3000, favorite: false },    // new
      ],
    };

    const result = await provider.applyImport(incoming, 'merge');
    expect(clipboardHistoryStore.clearHistory).not.toHaveBeenCalled();
    expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledTimes(1);
    expect(result.itemsAdded).toBe(1);
  });

  it('applyImport skip — does nothing', async () => {
    const { clipboardHistoryStore } = await import('../../clipboard/stores/clipboardHistoryStore.svelte');
    const incoming: SyncProviderData = {
      providerId: 'clipboard',
      version: 1,
      exportedAt: Date.now(),
      data: [{ id: 'c99', type: 'text', content: 'X', createdAt: 1, favorite: false }],
    };

    const result = await provider.applyImport(incoming, 'skip');
    expect(clipboardHistoryStore.clearHistory).not.toHaveBeenCalled();
    expect(clipboardHistoryStore.addHistoryItem).not.toHaveBeenCalled();
    expect(result.itemsAdded).toBe(0);
    expect(result.itemsUpdated).toBe(0);
  });

  it('getLocalSummary returns correct count', async () => {
    const summary = await provider.getLocalSummary();
    expect(summary.itemCount).toBe(2);
    expect(summary.label).toBe('2 clipboard item(s)');
  });
});

describe('exportForSync() content stripping', () => {
  let provider: ClipboardSyncProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new ClipboardSyncProvider();
  });

  it('strips HTML tags from html items and downgrades type to text', async () => {
    const { clipboardHistoryStore } = await import('../../clipboard/stores/clipboardHistoryStore.svelte');
    vi.mocked(clipboardHistoryStore.getHistoryItems).mockResolvedValueOnce([
      { id: 'h1', type: 'html' as any, content: '<p>Hello <b>world</b></p>', preview: 'Hello world', createdAt: 1000, favorite: false },
    ]);

    const result = await provider.exportForSync();
    const data = result.data as any[];

    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('h1');
    expect(data[0].content).toBe('Hello world');
    expect(data[0].type).toBe('text');
  });

  it('strips RTF markup from rtf items and downgrades type to text', async () => {
    const { clipboardHistoryStore } = await import('../../clipboard/stores/clipboardHistoryStore.svelte');
    vi.mocked(clipboardHistoryStore.getHistoryItems).mockResolvedValueOnce([
      { id: 'r1', type: 'rtf' as any, content: '{\\rtf1 visible text}', preview: 'visible text', createdAt: 1000, favorite: false },
    ]);

    const result = await provider.exportForSync();
    const data = result.data as any[];

    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('r1');
    expect(data[0].content).toBe('visible text');
    expect(data[0].type).toBe('text');
  });

  it('leaves text items unchanged', async () => {
    const { clipboardHistoryStore } = await import('../../clipboard/stores/clipboardHistoryStore.svelte');
    vi.mocked(clipboardHistoryStore.getHistoryItems).mockResolvedValueOnce([
      { id: 't1', type: 'text' as any, content: 'plain text', createdAt: 1000, favorite: false },
    ]);

    const result = await provider.exportForSync();
    const data = result.data as any[];

    expect(data[0].content).toBe('plain text');
    expect(data[0].type).toBe('text');
  });

  it('exportFull preserves raw HTML content unchanged', async () => {
    const { clipboardHistoryStore } = await import('../../clipboard/stores/clipboardHistoryStore.svelte');
    vi.mocked(clipboardHistoryStore.getHistoryItems).mockResolvedValueOnce([
      { id: 'h2', type: 'html' as any, content: '<p>Hello <b>world</b></p>', createdAt: 1000, favorite: false },
    ]);

    const result = await provider.exportFull();
    const data = result.data as any[];

    expect(data[0].content).toBe('<p>Hello <b>world</b></p>');
    expect(data[0].type).toBe('html');
  });
});

describe('ClipboardSyncProvider — delta sync surface', () => {
  let provider: ClipboardSyncProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new ClipboardSyncProvider();
  });

  it('exportItems returns one SyncItem per non-image clipboard entry', async () => {
    // c2 is an image and is filtered out — image bytes go through the
    // separate binary asset path, not the text-delta sync channel.
    const items = await provider.exportItems();
    expect(items.length).toBe(1);
    expect(items[0].id).toBe('c1');
    expect(items[0].categoryId).toBe('clipboard');
  });

  it('applyItemUpsert routes to addHistoryItem with the content', async () => {
    const { clipboardHistoryStore } = await import('../../clipboard/stores/clipboardHistoryStore.svelte');
    const content = { id: 'c10', type: 'text', content: 'Hello', createdAt: 5000, favorite: false };
    await provider.applyItemUpsert({ id: 'c10', categoryId: 'clipboard', content });
    expect(clipboardHistoryStore.addHistoryItem).toHaveBeenCalledWith(content);
  });

  it('applyItemDelete routes to deleteHistoryItem with the id', async () => {
    const { clipboardHistoryStore } = await import('../../clipboard/stores/clipboardHistoryStore.svelte');
    await provider.applyItemDelete('c1');
    expect(clipboardHistoryStore.deleteHistoryItem).toHaveBeenCalledWith('c1');
  });

  it('subscribeToChanges fires when the store emits an upsert', async () => {
    const events: Array<{ type: string; itemId: string; categoryId: string }> = [];
    const unsub = provider.subscribeToChanges((ev) => events.push(ev));

    const { clipboardHistoryStore } = await import('../../clipboard/stores/clipboardHistoryStore.svelte');
    (clipboardHistoryStore as unknown as {
      __emit: (e: { type: 'upsert' | 'delete'; itemId: string }) => void;
    }).__emit({ type: 'upsert', itemId: 'c5' });

    expect(events.length).toBe(1);
    expect(events[0]).toEqual({ type: 'upsert', itemId: 'c5', categoryId: 'clipboard' });
    unsub();
  });

  it('subscribeToChanges propagates delete events', async () => {
    const events: Array<{ type: string; itemId: string; categoryId: string }> = [];
    const unsub = provider.subscribeToChanges((ev) => events.push(ev));

    const { clipboardHistoryStore } = await import('../../clipboard/stores/clipboardHistoryStore.svelte');
    (clipboardHistoryStore as unknown as {
      __emit: (e: { type: 'upsert' | 'delete'; itemId: string }) => void;
    }).__emit({ type: 'delete', itemId: 'c1' });

    expect(events).toEqual([{ type: 'delete', itemId: 'c1', categoryId: 'clipboard' }]);
    unsub();
  });
});
