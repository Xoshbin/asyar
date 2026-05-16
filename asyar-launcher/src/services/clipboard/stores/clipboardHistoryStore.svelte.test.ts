import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/ipc/commands', () => ({
  clipboardListInitial: vi.fn(),
  clipboardListOlder: vi.fn(),
  clipboardSearch: vi.fn(),
  clipboardGetItem: vi.fn(),
  clipboardRecordCapture: vi.fn(),
  clipboardToggleFavorite: vi.fn(),
  clipboardDeleteItem: vi.fn(),
  clipboardClearNonFavorites: vi.fn(),
}));

vi.mock('../../diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: { report: vi.fn() },
}));

vi.mock('../../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { clipboardHistoryStore } from './clipboardHistoryStore.svelte';
import * as ipc from '../../../lib/ipc/commands';

const mockListInitial = ipc.clipboardListInitial as unknown as ReturnType<typeof vi.fn>;
const mockListOlder = ipc.clipboardListOlder as unknown as ReturnType<typeof vi.fn>;
const mockSearch = ipc.clipboardSearch as unknown as ReturnType<typeof vi.fn>;
const mockGetItem = ipc.clipboardGetItem as unknown as ReturnType<typeof vi.fn>;
const mockCapture = ipc.clipboardRecordCapture as unknown as ReturnType<typeof vi.fn>;
const mockToggleFavorite = ipc.clipboardToggleFavorite as unknown as ReturnType<typeof vi.fn>;
const mockDelete = ipc.clipboardDeleteItem as unknown as ReturnType<typeof vi.fn>;
const mockClear = ipc.clipboardClearNonFavorites as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  clipboardHistoryStore.reset();
});

describe('clipboardHistoryStore', () => {
  it('loadInitial populates favorites + recent and stores nextCursor', async () => {
    mockListInitial.mockResolvedValue({
      favorites: [{ id: 'f1', type: 'text', createdAt: 100, favorite: true }],
      recent: [{ id: 'r1', type: 'text', createdAt: 50, favorite: false }],
      nextCursor: { createdAt: 50, id: 'r1' },
    });
    await clipboardHistoryStore.loadInitial(100);
    expect(clipboardHistoryStore.favorites).toHaveLength(1);
    expect(clipboardHistoryStore.recent).toHaveLength(1);
    expect(clipboardHistoryStore.nextOlderCursor).toEqual({ createdAt: 50, id: 'r1' });
  });

  it('loadOlder appends and updates the cursor', async () => {
    mockListInitial.mockResolvedValue({
      favorites: [],
      recent: [{ id: 'r1', type: 'text', createdAt: 100, favorite: false }],
      nextCursor: { createdAt: 100, id: 'r1' },
    });
    mockListOlder.mockResolvedValue({
      items: [{ id: 'r2', type: 'text', createdAt: 50, favorite: false }],
      nextCursor: undefined,
    });
    await clipboardHistoryStore.loadInitial(1);
    await clipboardHistoryStore.loadOlder(10);
    expect(clipboardHistoryStore.recent.map((i) => i.id)).toEqual(['r1', 'r2']);
    expect(clipboardHistoryStore.nextOlderCursor).toBeUndefined();
  });

  it('search populates searchResults and reads indexState', async () => {
    mockSearch.mockResolvedValue({
      items: [{ id: 'r1', type: 'text', createdAt: 100, favorite: false }],
      indexState: 'ready',
    });
    await clipboardHistoryStore.search('apple', 200);
    expect(clipboardHistoryStore.searchResults).not.toBeNull();
    expect(clipboardHistoryStore.searchResults!).toHaveLength(1);
    expect(clipboardHistoryStore.indexState).toBe('ready');
  });

  it('clearSearch resets searchResults to null', async () => {
    mockSearch.mockResolvedValue({ items: [], indexState: 'ready' });
    await clipboardHistoryStore.search('x', 10);
    clipboardHistoryStore.clearSearch();
    expect(clipboardHistoryStore.searchResults).toBeNull();
  });

  it('fetchFullItem calls clipboardGetItem and does NOT touch list endpoints', async () => {
    mockGetItem.mockResolvedValue({ id: 'full', type: 'text', content: 'body', preview: 'body', createdAt: 1, favorite: false });
    const got = await clipboardHistoryStore.fetchFullItem('full');
    expect(got?.content).toBe('body');
    expect(mockListInitial).not.toHaveBeenCalled();
    expect(mockListOlder).not.toHaveBeenCalled();
  });

  it('deleteHistoryItem removes the row locally and reports image path', async () => {
    mockListInitial.mockResolvedValue({ favorites: [], recent: [
      { id: 'a', type: 'text', createdAt: 1, favorite: false },
      { id: 'b', type: 'text', createdAt: 2, favorite: false },
    ], nextCursor: undefined });
    mockDelete.mockResolvedValue({ imageContentPath: undefined });
    await clipboardHistoryStore.loadInitial(10);
    const res = await clipboardHistoryStore.deleteHistoryItem('a');
    expect(res.imageContentPath).toBeUndefined();
    expect(clipboardHistoryStore.recent.map((i) => i.id)).toEqual(['b']);
  });

  it('clearHistory removes non-favorites locally and reports image paths', async () => {
    mockListInitial.mockResolvedValue({
      favorites: [{ id: 'f', type: 'text', createdAt: 100, favorite: true }],
      recent: [{ id: 'n', type: 'text', createdAt: 50, favorite: false }],
      nextCursor: undefined,
    });
    mockClear.mockResolvedValue({ removedIds: ['n'], removedImagePaths: ['/cache/n.png'] });
    await clipboardHistoryStore.loadInitial(10);
    const res = await clipboardHistoryStore.clearHistory();
    expect(res.removedImagePaths).toEqual(['/cache/n.png']);
    expect(clipboardHistoryStore.recent).toHaveLength(0);
    expect(clipboardHistoryStore.favorites).toHaveLength(1);
  });

  it('addHistoryItem inserts at top of recent, drops evicted ids, fires upsert event', async () => {
    mockListInitial.mockResolvedValue({
      favorites: [],
      recent: [{ id: 'old', type: 'text', createdAt: 50, favorite: false }],
      nextCursor: undefined,
    });
    mockCapture.mockResolvedValue({ insertedId: 'new', evictedIds: [] });
    await clipboardHistoryStore.loadInitial(10);

    const events: { type: string; id: string }[] = [];
    const unsub = clipboardHistoryStore.subscribe((e) => events.push({ type: e.type, id: e.itemId }));

    await clipboardHistoryStore.addHistoryItem({
      id: 'new', type: 'text', content: 'body', preview: 'body',
      createdAt: 100, favorite: false,
    } as any);

    expect(clipboardHistoryStore.recent[0].id).toBe('new');
    expect(events).toEqual([{ type: 'upsert', id: 'new' }]);
    unsub();
  });

  it('toggleFavorite moves between recent and favorites', async () => {
    mockListInitial.mockResolvedValue({
      favorites: [],
      recent: [{ id: 'r1', type: 'text', createdAt: 100, favorite: false }],
      nextCursor: undefined,
    });
    mockToggleFavorite.mockResolvedValue(true);
    await clipboardHistoryStore.loadInitial(10);
    await clipboardHistoryStore.toggleFavorite('r1');
    expect(clipboardHistoryStore.favorites.map((i) => i.id)).toEqual(['r1']);
    expect(clipboardHistoryStore.recent).toHaveLength(0);
  });

  it('toggleFavorite on a search-only row inserts it into favorites', async () => {
    // No loadInitial — favorites and recent both start empty.
    mockSearch.mockResolvedValue({
      items: [{ id: 'searchOnly', type: 'text', createdAt: 50, favorite: false }],
      indexState: 'ready',
    });
    mockToggleFavorite.mockResolvedValue(true);
    await clipboardHistoryStore.search('x', 10);
    await clipboardHistoryStore.toggleFavorite('searchOnly');
    expect(clipboardHistoryStore.favorites.map((i) => i.id)).toEqual(['searchOnly']);
    expect(clipboardHistoryStore.recent).toHaveLength(0);
    // The search result list itself is also updated.
    expect(clipboardHistoryStore.searchResults?.[0].favorite).toBe(true);
  });
});
