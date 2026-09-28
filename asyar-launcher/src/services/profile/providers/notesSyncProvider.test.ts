import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotesSyncProvider } from './notesSyncProvider';
import type { SyncProviderData } from '../types';

const mockNoteGetAll = vi.fn();
const mockNoteUpsert = vi.fn();
const mockNoteUpdate = vi.fn();
const mockNoteRemove = vi.fn();
vi.mock('../../../lib/ipc/commands', () => ({
  noteGetAllForService: (...args: unknown[]) => mockNoteGetAll(...args),
  noteUpsert: (...args: unknown[]) => mockNoteUpsert(...args),
  noteUpdate: (...args: unknown[]) => mockNoteUpdate(...args),
  noteRemove: (...args: unknown[]) => mockNoteRemove(...args),
}));

let noteChangeListener:
  ((event: { payload: { id: string; type: 'upsert' | 'delete' } }) => void) | undefined;
const mockUnlisten = vi.fn();
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(
    async (
      _event: string,
      callback: (event: { payload: { id: string; type: 'upsert' | 'delete' } }) => void,
    ) => {
      noteChangeListener = callback;
      return mockUnlisten;
    },
  ),
}));

const mockNotes = [
  {
    id: '1',
    title: 'Grocery List',
    body: 'milk, eggs',
    createdAt: 1000,
    updatedAt: 1000,
    pinned: false,
  },
  {
    id: '2',
    title: 'Meeting Notes',
    body: 'quarterly review',
    createdAt: 2000,
    updatedAt: 2000,
    pinned: false,
  },
];

describe('NotesSyncProvider', () => {
  let provider: NotesSyncProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockNoteGetAll.mockResolvedValue([...mockNotes]);
    noteChangeListener = undefined;
    provider = new NotesSyncProvider();
  });

  it('has correct metadata', () => {
    expect(provider.id).toBe('notes');
    // 'core' matches every other registered provider (snippets, shortcuts,
    // portals, clipboard, settings, ai-settings, extensions, extension
    // preferences) — 'extended' is a defined-but-currently-unused tier, so
    // there is no precedent for placing a new feature there.
    expect(provider.syncTier).toBe('core');
    expect(provider.defaultEnabled).toBe(true);
    expect(provider.defaultConflictStrategy).toBe('merge');
    expect(provider.sensitiveFields).toEqual([]);
  });

  describe('exportFull', () => {
    it('exports all notes', async () => {
      const result = await provider.exportFull();
      expect(mockNoteGetAll).toHaveBeenCalledOnce();
      expect(result.providerId).toBe('notes');
      expect(result.version).toBe(1);
      expect(result.data).toEqual(mockNotes);
      expect(result.binaryAssets).toBeUndefined();
    });
  });

  describe('exportForSync', () => {
    it('returns the same data as exportFull (no binary data)', async () => {
      const full = await provider.exportFull();
      const sync = await provider.exportForSync();
      expect(sync.data).toEqual(full.data);
    });
  });

  describe('preview', () => {
    it('calculates correct preview stats', async () => {
      const incoming: SyncProviderData = {
        providerId: 'notes',
        version: 1,
        exportedAt: Date.now(),
        data: [
          {
            id: '1',
            title: 'Grocery List',
            body: 'Updated',
            createdAt: 1000,
            updatedAt: 3000,
            pinned: false,
          },
          {
            id: '3',
            title: 'New Note',
            body: 'brand new',
            createdAt: 3000,
            updatedAt: 3000,
            pinned: false,
          },
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
      const incoming: SyncProviderData = {
        providerId: 'notes',
        version: 1,
        exportedAt: Date.now(),
        data: [
          {
            id: '10',
            title: 'New',
            body: 'new item',
            createdAt: 5000,
            updatedAt: 5000,
            pinned: false,
          },
        ],
      };

      const result = await provider.applyImport(incoming, 'replace');
      // Notes has no clearAll (unlike snippets/clipboard) — a "clear
      // everything" action for a document store is a deliberately omitted,
      // more-destructive-than-warranted feature (see the plan doc). Replace
      // strategy removes existing items individually instead.
      expect(mockNoteRemove).toHaveBeenCalledTimes(2);
      expect(mockNoteRemove).toHaveBeenCalledWith('1');
      expect(mockNoteRemove).toHaveBeenCalledWith('2');
      expect(mockNoteUpsert).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.itemsAdded).toBe(1);
      expect(result.itemsRemoved).toBe(2);
    });

    it('merges new items and updates ones with a newer updatedAt', async () => {
      const incoming: SyncProviderData = {
        providerId: 'notes',
        version: 1,
        exportedAt: Date.now(),
        data: [
          {
            id: '1',
            title: 'Grocery List',
            body: 'Updated',
            createdAt: 1000,
            updatedAt: 9999,
            pinned: false,
          }, // newer
          {
            id: '2',
            title: 'Meeting Notes',
            body: 'stale',
            createdAt: 2000,
            updatedAt: 500,
            pinned: false,
          }, // older
          {
            id: '3',
            title: 'New',
            body: 'brand new',
            createdAt: 3000,
            updatedAt: 3000,
            pinned: false,
          }, // new
        ],
      };

      const result = await provider.applyImport(incoming, 'merge');
      expect(mockNoteUpsert).toHaveBeenCalledTimes(1); // id '3'
      expect(mockNoteUpdate).toHaveBeenCalledWith(
        '1',
        { title: 'Grocery List', body: 'Updated', pinned: false },
        9999,
      );
      expect(result.itemsAdded).toBe(1);
      expect(result.itemsUpdated).toBe(1);
    });

    it('does nothing on skip strategy', async () => {
      const incoming: SyncProviderData = {
        providerId: 'notes',
        version: 1,
        exportedAt: Date.now(),
        data: [{ id: '99', title: 'X', body: 'x', createdAt: 1, updatedAt: 1, pinned: false }],
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
      expect(summary.label).toBe('2 notes');
    });
  });

  describe('exportItems', () => {
    it('returns one SyncItem per note keyed by id', async () => {
      const items = await provider.exportItems();
      expect(items.length).toBe(2);
      expect(items[0].id).toBe('1');
      expect(items[0].categoryId).toBe('notes');
      expect(items[1].id).toBe('2');
    });
  });

  describe('applyItemUpsert', () => {
    it('routes to the platform note command', async () => {
      const content = {
        id: '99',
        title: 'N',
        body: 'new',
        createdAt: 9000,
        updatedAt: 9000,
        pinned: false,
      };
      await provider.applyItemUpsert({ id: '99', categoryId: 'notes', content });
      expect(mockNoteUpsert).toHaveBeenCalledWith(content);
    });
  });

  describe('applyItemDelete', () => {
    it('routes to the platform note command', async () => {
      await provider.applyItemDelete('1');
      expect(mockNoteRemove).toHaveBeenCalledWith('1');
    });
  });

  describe('subscribeToChanges', () => {
    it('propagates Rust platform events with categoryId attached', async () => {
      const events: Array<{ type: string; itemId: string; categoryId: string }> = [];
      const unsub = provider.subscribeToChanges((ev) => events.push(ev));

      await vi.waitFor(() => expect(noteChangeListener).toBeDefined());
      noteChangeListener?.({ payload: { type: 'upsert', id: '1' } });
      noteChangeListener?.({ payload: { type: 'delete', id: '2' } });

      expect(events).toEqual([
        { type: 'upsert', itemId: '1', categoryId: 'notes' },
        { type: 'delete', itemId: '2', categoryId: 'notes' },
      ]);
      unsub();
      expect(mockUnlisten).toHaveBeenCalledOnce();
    });
  });
});
