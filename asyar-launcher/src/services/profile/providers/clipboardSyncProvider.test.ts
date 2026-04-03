import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClipboardSyncProvider } from './clipboardSyncProvider';
import type { SyncProviderData } from '../types';

const mockItems = [
  { id: 'c1', type: 'text', content: 'Hello World', createdAt: 1000, favorite: false },
  { id: 'c2', type: 'image', createdAt: 2000, favorite: false },
];

vi.mock('../../clipboard/stores/clipboardHistoryStore.svelte', () => ({
  clipboardHistoryStore: {
    getHistoryItems: vi.fn().mockResolvedValue([
      { id: 'c1', type: 'text', content: 'Hello World', createdAt: 1000, favorite: false },
      { id: 'c2', type: 'image', createdAt: 2000, favorite: false },
    ]),
    addHistoryItem: vi.fn().mockResolvedValue(undefined),
    clearHistory: vi.fn().mockResolvedValue(undefined),
    deleteHistoryItem: vi.fn().mockResolvedValue(undefined),
  },
}));

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
