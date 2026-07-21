/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./noteStore.svelte', () => {
  const store = {
    notes: [] as any[],
    add(note: any) {
      store.notes = [note, ...store.notes.filter((n) => n.id !== note.id)];
    },
  };
  return { noteStore: store };
});
// The Rust FTS5 index's ranking behavior is covered by Rust tests
// (storage::notes_fts); here we only verify the view state delegates
// correctly and renders the order/index-state Rust returns.
vi.mock('../../lib/ipc/commands', () => ({ noteSearch: vi.fn() }));

import { noteViewState } from './noteViewState.svelte';
import { noteStore } from './noteStore.svelte';
import { noteSearch } from '../../lib/ipc/commands';

const mockNotes = [
  {
    id: '1',
    title: 'Work Email',
    body: 'work@example.com',
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
  },
  {
    id: '2',
    title: 'Home Address',
    body: '123 Main St',
    createdAt: 2,
    updatedAt: 2,
    pinned: false,
  },
  { id: '3', title: 'Z-Note', body: 'zzz', createdAt: 3, updatedAt: 3, pinned: false },
];

function searchResult(items: any[], indexState: 'ready' | 'indexing' = 'ready') {
  return { items, indexState };
}

describe('noteViewState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(noteSearch).mockResolvedValue(searchResult([]));
    noteViewState.reset();
    (noteStore as any).notes = [...mockNotes];
  });

  describe('getFilteredNotes()', () => {
    it('returns all when no query (no Rust round-trip)', () => {
      expect(noteViewState.getFilteredNotes()).toHaveLength(3);
      expect(noteSearch).not.toHaveBeenCalled();
    });

    it('returns the items Rust ranked, in order', async () => {
      vi.mocked(noteSearch).mockResolvedValueOnce(searchResult([mockNotes[0]]));
      await noteViewState.setSearch('work');
      const filtered = noteViewState.getFilteredNotes();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Work Email');
    });

    it('reflects an "indexing" result while the FTS index is still rebuilding', async () => {
      vi.mocked(noteSearch).mockResolvedValueOnce(searchResult([], 'indexing'));
      await noteViewState.setSearch('work');
      expect(noteViewState.indexState).toBe('indexing');
      expect(noteViewState.getFilteredNotes()).toHaveLength(0);
    });
  });

  describe('setSearch(query)', () => {
    it('updates searchQuery and resets selectedIndex to first match', async () => {
      vi.mocked(noteSearch).mockResolvedValueOnce(searchResult([mockNotes[0]]));
      noteViewState.selectItem(2);
      await noteViewState.setSearch('work');
      expect(noteViewState.searchQuery).toBe('work');
      expect(noteViewState.selectedIndex).toBe(0);
    });

    it('clears the active search and skips Rust for an empty query', async () => {
      vi.mocked(noteSearch).mockResolvedValueOnce(searchResult([mockNotes[0]]));
      await noteViewState.setSearch('work');
      await noteViewState.setSearch('   ');
      expect(noteViewState.getFilteredNotes()).toHaveLength(3);
      expect(noteSearch).toHaveBeenCalledTimes(1);
    });

    it('ignores a stale result when a newer query has superseded it', async () => {
      let resolveFirst: (v: any) => void = () => {};
      vi.mocked(noteSearch)
        .mockImplementationOnce(
          () =>
            new Promise((r) => {
              resolveFirst = r;
            }),
        )
        .mockResolvedValueOnce(searchResult([mockNotes[1]]));

      const first = noteViewState.setSearch('work');
      const second = noteViewState.setSearch('addr');
      await second;
      resolveFirst(searchResult([mockNotes[0]])); // late result for the abandoned "work" query
      await first;

      const filtered = noteViewState.getFilteredNotes();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Home Address');
    });
  });

  describe('selectAfterMutation(id)', () => {
    it('selects the item directly when no search is active', async () => {
      await noteViewState.selectAfterMutation('3');
      expect(noteViewState.selectedNote?.id).toBe('3');
      expect(noteSearch).not.toHaveBeenCalled();
    });
  });

  describe('moveSelection(dir)', () => {
    // Empty-list clamping (-> -1) is useListSelection's own contract,
    // covered by listSelection.svelte.test.ts; this suite only needs to
    // verify moveSelection delegates and wraps correctly.
    it('wraps cyclically for down', () => {
      noteViewState.selectItem(2);
      noteViewState.moveSelection('down');
      expect(noteViewState.selectedIndex).toBe(0);
    });
  });

  describe('createNote()', () => {
    it('adds a blank note, selects it, and marks it justCreatedId', async () => {
      await noteViewState.createNote();
      expect((noteStore as any).notes).toHaveLength(4);
      const created = (noteStore as any).notes[0];
      expect(created.title).toBe('');
      expect(created.body).toBe('');
      expect(noteViewState.selectedNote?.id).toBe(created.id);
      expect(noteViewState.justCreatedId).toBe(created.id);
    });

    it('clears any active search so the new note is visible', async () => {
      vi.mocked(noteSearch).mockResolvedValueOnce(searchResult([mockNotes[0]]));
      await noteViewState.setSearch('work');
      expect(noteViewState.searchQuery).toBe('work');

      await noteViewState.createNote();
      expect(noteViewState.searchQuery).toBe('');
    });
  });

  describe('reset()', () => {
    it('resets everything to initial state', async () => {
      vi.mocked(noteSearch).mockResolvedValueOnce(searchResult([mockNotes[0]]));
      await noteViewState.setSearch('work');
      noteViewState.selectItem(0);

      noteViewState.reset();

      expect(noteViewState.searchQuery).toBe('');
      expect(noteViewState.indexState).toBe('ready');
      expect(noteViewState.justCreatedId).toBe(null);
      expect(noteViewState.selectedIndex).toBe(0);
      expect(noteViewState.getFilteredNotes()).toHaveLength(3);
    });
  });

  describe('selectedNote getter', () => {
    it('returns correct item for current index', () => {
      noteViewState.selectItem(1);
      expect(noteViewState.selectedNote?.id).toBe('2');
    });

    it('returns null if no items', () => {
      (noteStore as any).notes = [];
      expect(noteViewState.selectedNote).toBe(null);
    });
  });

  describe('ordering is Rust-owned (no frontend sort)', () => {
    it('getFilteredNotes() returns the store array as-is (Rust already ordered it)', () => {
      // Rust returns pinned-first, newest-first; the view must NOT re-sort.
      (noteStore as any).notes = [
        { id: '2', title: 'B', body: 'b', createdAt: 2, updatedAt: 2, pinned: true },
        { id: '1', title: 'A', body: 'a', createdAt: 1, updatedAt: 1, pinned: false },
        { id: '3', title: 'C', body: 'c', createdAt: 3, updatedAt: 3, pinned: false },
      ];
      expect(noteViewState.getFilteredNotes().map((n) => n.id)).toEqual(['2', '1', '3']);
    });

    it('pinnedCount counts pinned notes in list mode', () => {
      (noteStore as any).notes = [
        { id: '1', title: 'A', body: 'a', createdAt: 1, updatedAt: 1, pinned: true },
        { id: '2', title: 'B', body: 'b', createdAt: 2, updatedAt: 2, pinned: true },
        { id: '3', title: 'C', body: 'c', createdAt: 3, updatedAt: 3, pinned: false },
      ];
      expect(noteViewState.pinnedCount).toBe(2);
    });

    it('pinnedCount is 0 during a search (no section dividers)', async () => {
      (noteStore as any).notes = [
        { id: '1', title: 'A', body: 'a', createdAt: 1, updatedAt: 1, pinned: true },
      ];
      vi.mocked(noteSearch).mockResolvedValueOnce(searchResult([mockNotes[0]]));
      await noteViewState.setSearch('a');
      expect(noteViewState.pinnedCount).toBe(0);
    });
  });
});
