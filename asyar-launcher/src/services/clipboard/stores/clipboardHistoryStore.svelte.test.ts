import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/ipc/commands', () => ({
  clipboardListInitial: vi.fn(),
  clipboardListOlder: vi.fn(),
  clipboardSearch: vi.fn(),
  clipboardListSourceApps: vi.fn(),
  clipboardGetItem: vi.fn(),
  clipboardRecordCapture: vi.fn(),
  clipboardToggleFavorite: vi.fn(),
  clipboardDeleteItem: vi.fn(),
  clipboardClearNonFavorites: vi.fn(),
}));

vi.mock('../../settings/settingsService.svelte', () => ({
  settingsService: {
    currentSettings: {
      clipboardHistory: { retentionMs: 90 * 24 * 60 * 60 * 1000 },
    },
  },
}));

vi.mock('../../../lib/ipc/clipboardCacheCommands', () => ({
  clipboardForgetImage: vi.fn(),
}));

vi.mock('../../feedback/feedbackService.svelte', () => ({
  feedbackService: { report: vi.fn() },
}));

vi.mock('../../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { clipboardHistoryStore } from './clipboardHistoryStore.svelte';
import * as ipc from '../../../lib/ipc/commands';
import { clipboardForgetImage } from '../../../lib/ipc/clipboardCacheCommands';
import { logService } from '../../log/logService';

const mockListInitial = ipc.clipboardListInitial as unknown as ReturnType<typeof vi.fn>;
const mockListOlder = ipc.clipboardListOlder as unknown as ReturnType<typeof vi.fn>;
const mockSearch = ipc.clipboardSearch as unknown as ReturnType<typeof vi.fn>;
const mockListSourceApps = ipc.clipboardListSourceApps as unknown as ReturnType<typeof vi.fn>;
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
  it('ignores stale initial and older pages after a newer listing', async () => {
    let initialDone!: (value: unknown) => void;
    mockListInitial.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          initialDone = resolve;
        }),
    );
    const initial = clipboardHistoryStore.loadInitial(100, { sourceApp: 'Old' });
    mockListInitial.mockResolvedValueOnce({
      favorites: [],
      recent: [],
      nextCursor: { createdAt: 1, id: 'new' },
    });
    await clipboardHistoryStore.loadInitial(100, { sourceApp: 'New' });
    initialDone({ favorites: [], recent: [{ id: 'stale' }] });
    await initial;
    expect(clipboardHistoryStore.recent).toEqual([]);
    expect(clipboardHistoryStore.activeFilter).toEqual({ sourceApp: 'New' });
    let olderDone!: (value: unknown) => void;
    mockListOlder.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          olderDone = resolve;
        }),
    );
    const older = clipboardHistoryStore.loadOlder();
    mockListInitial.mockResolvedValueOnce({ favorites: [], recent: [] });
    await clipboardHistoryStore.loadInitial();
    olderDone({ items: [{ id: 'stale' }] });
    await older;
    expect(clipboardHistoryStore.recent).toEqual([]);
    expect(clipboardHistoryStore.activeFilter).toBeUndefined();
  });

  it('keeps the committed filter when an initial request fails', async () => {
    mockListInitial.mockRejectedValueOnce(new Error('failed'));
    await expect(clipboardHistoryStore.loadInitial(100, { sourceApp: 'Failed' })).rejects.toThrow();
    expect(clipboardHistoryStore.activeFilter).toBeUndefined();
  });

  it('restores pagination of committed rows after a current listing failure', async () => {
    const cursor = { createdAt: 10, id: 'old' };
    const filter = { sourceApp: 'Old' };
    mockListInitial.mockResolvedValueOnce({
      favorites: [],
      recent: [{ id: 'old' }],
      nextCursor: cursor,
    });
    await clipboardHistoryStore.loadInitial(100, filter);
    mockListInitial.mockRejectedValueOnce(new Error('failed'));
    await expect(clipboardHistoryStore.loadInitial(100, { sourceApp: 'New' })).rejects.toThrow();
    expect(clipboardHistoryStore.recent).toEqual([{ id: 'old' }]);
    expect(clipboardHistoryStore.activeFilter).toEqual(filter);
    expect(clipboardHistoryStore.nextOlderCursor).toEqual(cursor);
    mockListOlder.mockResolvedValueOnce({ items: [{ id: 'older' }] });
    await clipboardHistoryStore.loadOlder();
    expect(mockListOlder).toHaveBeenCalledWith(cursor, 200, filter);
  });

  it('tracks a pending filter and drops its response after an unfiltered request', async () => {
    let finish!: (value: unknown) => void;
    mockListInitial.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = clipboardHistoryStore.loadInitial(100, { sourceApp: 'Safari' });
    expect(clipboardHistoryStore.requestedFilter).toEqual({ sourceApp: 'Safari' });
    expect(clipboardHistoryStore.activeFilter).toBeUndefined();
    mockListInitial.mockResolvedValueOnce({ favorites: [], recent: [] });
    await clipboardHistoryStore.loadInitial();
    finish({
      favorites: [],
      recent: [{ id: 'filtered' }],
      nextCursor: { id: 'filtered', createdAt: 1 },
    });
    await pending;
    expect(clipboardHistoryStore.recent).toEqual([]);
    expect(clipboardHistoryStore.nextOlderCursor).toBeUndefined();
    expect(clipboardHistoryStore.requestedFilter).toBeUndefined();
  });

  it('does not restore pagination when a superseded listing rejects', async () => {
    const cursor = { createdAt: 10, id: 'old' };
    mockListInitial.mockResolvedValueOnce({ favorites: [], recent: [], nextCursor: cursor });
    await clipboardHistoryStore.loadInitial();
    let rejectOld!: (reason: Error) => void;
    mockListInitial.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectOld = reject;
        }),
    );
    const old = clipboardHistoryStore.loadInitial(100, { sourceApp: 'Old' });
    const rejected = expect(old).rejects.toThrow('failed');
    let finish!: (value: unknown) => void;
    mockListInitial.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const current = clipboardHistoryStore.loadInitial(100, { sourceApp: 'New' });
    rejectOld(new Error('failed'));
    await rejected;
    await clipboardHistoryStore.loadOlder();
    expect(mockListOlder).not.toHaveBeenCalled();
    expect(clipboardHistoryStore.requestedFilter).toEqual({ sourceApp: 'New' });
    finish({ favorites: [], recent: [] });
    await current;
  });

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
    mockGetItem.mockResolvedValue({
      id: 'full',
      type: 'text',
      content: 'body',
      preview: 'body',
      createdAt: 1,
      favorite: false,
    });
    const got = await clipboardHistoryStore.fetchFullItem('full');
    expect(got?.content).toBe('body');
    expect(mockListInitial).not.toHaveBeenCalled();
    expect(mockListOlder).not.toHaveBeenCalled();
  });

  it('deleteHistoryItem removes the row locally and reports image path', async () => {
    mockListInitial.mockResolvedValue({
      favorites: [],
      recent: [
        { id: 'a', type: 'text', createdAt: 1, favorite: false },
        { id: 'b', type: 'text', createdAt: 2, favorite: false },
      ],
      nextCursor: undefined,
    });
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
    mockCapture.mockResolvedValue({
      insertedId: 'new',
      replacedId: null,
      replacedImagePath: null,
      favorite: false,
      evictedIds: [],
    });
    await clipboardHistoryStore.loadInitial(10);

    const events: { type: string; id: string }[] = [];
    const unsub = clipboardHistoryStore.subscribe((e) =>
      events.push({ type: e.type, id: e.itemId }),
    );

    await clipboardHistoryStore.addHistoryItem({
      id: 'new',
      type: 'text',
      content: 'body',
      preview: 'body',
      createdAt: 100,
      favorite: false,
    } as any);

    expect(clipboardHistoryStore.recent[0].id).toBe('new');
    expect(events).toEqual([{ type: 'upsert', id: 'new' }]);
    expect(mockCapture).toHaveBeenCalledWith(expect.anything(), 90 * 24 * 60 * 60 * 1000);
    expect(clipboardForgetImage).not.toHaveBeenCalled();
    unsub();
  });

  it.each([false, true])(
    'forgets only the replaced image even if cleanup fails (%s)',
    async (fails) => {
      mockCapture.mockResolvedValue({
        insertedId: 'new',
        replacedId: 'old',
        replacedImagePath: '/clipboard_cache/old.png',
        favorite: false,
        evictedIds: [],
      });
      if (fails) vi.mocked(clipboardForgetImage).mockRejectedValueOnce(new Error('cleanup failed'));
      else vi.mocked(clipboardForgetImage).mockResolvedValueOnce(true);

      await clipboardHistoryStore.addHistoryItem({
        id: 'new',
        type: 'image',
        content: '/clipboard_cache/new.png',
        createdAt: 100,
        favorite: false,
      } as any);

      expect(clipboardForgetImage).toHaveBeenCalledExactlyOnceWith('/clipboard_cache/old.png');
      expect(clipboardHistoryStore.recent.map((item) => item.id)).toEqual(['new']);
      if (fails) {
        expect(logService.warn).toHaveBeenCalledWith(
          expect.stringContaining('/clipboard_cache/old.png'),
        );
        expect(logService.warn).toHaveBeenCalledWith(expect.stringContaining('cleanup failed'));
        mockCapture.mockResolvedValue({
          insertedId: 'newer',
          replacedId: null,
          replacedImagePath: null,
          favorite: false,
          evictedIds: [],
        });
        await clipboardHistoryStore.addHistoryItem({
          id: 'newer',
          type: 'text',
          content: 'again',
          preview: 'again',
          createdAt: 200,
          favorite: false,
        } as any);
        expect(clipboardForgetImage).toHaveBeenNthCalledWith(2, '/clipboard_cache/old.png');
        expect(clipboardHistoryStore.recent.map((item) => item.id)).toContain('new');
      } else {
        expect(logService.warn).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    { searching: false, favorite: false },
    { searching: false, favorite: true },
    { searching: true, favorite: false },
    { searching: true, favorite: true },
  ])(
    'reconciles replaced duplicate and search ranking (search=$searching, favorite=$favorite)',
    async ({ searching, favorite }) => {
      const old = { id: 'old', type: 'text', preview: 'body', createdAt: 50, favorite };
      const other = { id: 'other', type: 'text', preview: 'other', createdAt: 40, favorite: true };
      clipboardHistoryStore.favorites = favorite ? [other, old] : [other];
      clipboardHistoryStore.recent = [
        ...(favorite ? [] : [old]),
        { id: 'expired', type: 'text', createdAt: 1, favorite: false },
      ];
      if (searching) clipboardHistoryStore.searchResults = [other, old];

      const events: any[] = [];
      const unsub = clipboardHistoryStore.subscribe((e) => events.push(e));

      mockCapture.mockResolvedValue({
        insertedId: 'new',
        replacedId: old.id,
        favorite,
        evictedIds: ['expired'],
      });

      await clipboardHistoryStore.addHistoryItem({
        id: 'new',
        type: 'text',
        content: 'body',
        preview: 'body',
        createdAt: 100,
        favorite: false,
      } as any);

      const visible = clipboardHistoryStore.searchResults ?? [
        ...clipboardHistoryStore.favorites,
        ...clipboardHistoryStore.recent,
      ];
      expect(visible.map((item) => item.id)).not.toContain(old.id);
      expect(clipboardHistoryStore.recent.map((item) => item.id)).toEqual(favorite ? [] : ['new']);
      expect(visible.find((item) => item.id === 'new')?.favorite).toBe(favorite);
      if (searching) {
        expect(clipboardHistoryStore.searchResults?.map((item) => item.id)).toEqual([
          'other',
          'new',
        ]);
      }
      expect(events).toEqual([{ type: 'upsert', itemId: 'new', replacedItemId: 'old' }]);
      unsub();
    },
  );

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

  it('forwards ClipboardFilter across loadInitial, loadOlder, and search', async () => {
    const filter = { itemType: 'images', sourceApp: 'Safari', createdAfter: 100 };
    mockListInitial.mockResolvedValue({
      favorites: [],
      recent: [{ id: 'img-1', type: 'image', createdAt: 200, favorite: false }],
      nextCursor: { createdAt: 200, id: 'img-1' },
    });
    mockListOlder.mockResolvedValue({
      items: [{ id: 'img-2', type: 'image', createdAt: 150, favorite: false }],
      nextCursor: undefined,
    });
    mockSearch.mockResolvedValue({
      items: [{ id: 'img-1', type: 'image', createdAt: 200, favorite: false }],
      indexState: 'ready',
    });

    await clipboardHistoryStore.loadInitial(50, filter);
    expect(mockListInitial).toHaveBeenCalledWith(50, filter);
    expect(clipboardHistoryStore.activeFilter).toEqual(filter);

    await clipboardHistoryStore.loadOlder(25);
    expect(mockListOlder).toHaveBeenCalledWith({ createdAt: 200, id: 'img-1' }, 25, filter);

    await clipboardHistoryStore.search('hero', 30, filter);
    expect(mockSearch).toHaveBeenCalledWith('hero', 30, filter);
  });

  it('loadSourceApps stores distinct source apps returned from backend', async () => {
    mockListSourceApps.mockResolvedValue([
      { name: 'Safari', bundleId: 'com.apple.Safari', iconUrl: null, count: 14 },
      { name: 'Code', bundleId: 'com.microsoft.VSCode', iconUrl: null, count: 9 },
    ]);

    const result = await clipboardHistoryStore.loadSourceApps();
    expect(mockListSourceApps).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2);
    expect(clipboardHistoryStore.sourceApps[0]?.name).toBe('Safari');
  });
});
