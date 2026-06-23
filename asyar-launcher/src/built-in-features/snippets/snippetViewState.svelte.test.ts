/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./snippetStore.svelte', () => ({
  snippetStore: { snippets: [] }
}));
// Ranking is delegated to the Rust engine via rankItems. The engine's
// fuzzy/tier behavior is covered by Rust tests (search_engine::ranker); here we
// only verify that the view state delegates correctly and renders the order
// Rust returns (with pinned items floated to the top).
vi.mock('../../lib/rankItems', () => ({ rankItems: vi.fn() }));

import { snippetViewState } from './snippetViewState.svelte';
import { snippetStore } from './snippetStore.svelte';
import { rankItems } from '../../lib/rankItems';

const mockSnippets = [
  { id: '1', name: 'Work Email', keyword: ';email', expansion: 'work@example.com', createdAt: Date.now() },
  { id: '2', name: 'Home Address', keyword: ';addr', expansion: '123 Main St', createdAt: Date.now() },
  { id: '3', name: 'Z-Snippet', keyword: ';zz', expansion: 'expansion of z', createdAt: Date.now() }
];

describe('snippetViewState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rankItems).mockResolvedValue([]); // default; tests override per-call
    snippetViewState.reset();
    snippetStore.snippets = [...mockSnippets];
  });

  describe('getFilteredSnippets()', () => {
    it('returns all when no query (no Rust round-trip)', () => {
      expect(snippetViewState.getFilteredSnippets()).toHaveLength(3);
      expect(rankItems).not.toHaveBeenCalled();
    });

    it('returns the items Rust ranked, in order', async () => {
      vi.mocked(rankItems).mockResolvedValueOnce([mockSnippets[0]]);
      await snippetViewState.setSearch('work');
      const filtered = snippetViewState.getFilteredSnippets();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('Work Email');
    });

    it('passes name/keyword/expansion field accessors to rankItems', async () => {
      vi.mocked(rankItems).mockResolvedValueOnce([]);
      await snippetViewState.setSearch('addr');
      const [query, items, fields] = vi.mocked(rankItems).mock.calls[0];
      expect(query).toBe('addr');
      expect(items).toHaveLength(3);
      const s = mockSnippets[1];
      expect(fields.id(s)).toBe('2');
      expect(fields.title(s)).toBe('Home Address');
      expect(fields.subtitle?.(s)).toBe('123 Main St');
      expect(fields.keywords?.(s)).toEqual([';addr']);
    });

    it('keyword accessor yields empty array when keyword is absent', async () => {
      vi.mocked(rankItems).mockResolvedValueOnce([]);
      await snippetViewState.setSearch('x');
      const fields = vi.mocked(rankItems).mock.calls[0][2];
      expect(fields.keywords?.({ id: 'n', name: 'No KW', expansion: 'e', createdAt: 1 } as any)).toEqual([]);
    });
  });

  describe('setSearch(query)', () => {
    it('updates searchQuery and resets selectedIndex to first match', async () => {
      vi.mocked(rankItems).mockResolvedValueOnce([mockSnippets[0]]);
      snippetViewState.selectItem(2);
      await snippetViewState.setSearch('work');
      expect(snippetViewState.searchQuery).toBe('work');
      expect(snippetViewState.selectedIndex).toBe(0);
    });

    it('drops selection to -1 when the query matches nothing', async () => {
      vi.mocked(rankItems).mockResolvedValueOnce([]);
      await snippetViewState.setSearch('zzz no match zzz');
      expect(snippetViewState.selectedIndex).toBe(-1);
    });

    it('clears the active search and skips Rust for an empty query', async () => {
      vi.mocked(rankItems).mockResolvedValueOnce([mockSnippets[0]]);
      await snippetViewState.setSearch('work');
      await snippetViewState.setSearch('   ');
      expect(snippetViewState.getFilteredSnippets()).toHaveLength(3);
      expect(rankItems).toHaveBeenCalledTimes(1);
    });

    it('ignores a stale result when a newer query has superseded it', async () => {
      let resolveFirst: (v: any) => void = () => {};
      vi.mocked(rankItems)
        .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
        .mockResolvedValueOnce([mockSnippets[1]]);

      const first = snippetViewState.setSearch('work');
      const second = snippetViewState.setSearch('addr');
      await second;
      resolveFirst([mockSnippets[0]]); // late result for the abandoned "work" query
      await first;

      const filtered = snippetViewState.getFilteredSnippets();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('Home Address');
    });

    it('keeps edit mode if already in it', async () => {
      snippetViewState.mode = 'edit';
      await snippetViewState.setSearch('test');
      expect(snippetViewState.mode).toBe('edit');
    });

    it('keeps create mode if already in it', async () => {
      snippetViewState.mode = 'create';
      await snippetViewState.setSearch('test');
      expect(snippetViewState.mode).toBe('create');
    });
  });

  describe('selectAfterMutation(id)', () => {
    it('selects the item directly when no search is active', async () => {
      await snippetViewState.selectAfterMutation('3');
      expect(snippetViewState.selectedSnippet?.id).toBe('3');
      expect(rankItems).not.toHaveBeenCalled();
    });

    it('re-ranks against the live store before selecting, so a newly created item under an active filter is found', async () => {
      const created = { id: 'new', name: 'Brand New', keyword: ';bn', expansion: 'x', createdAt: Date.now() };
      vi.mocked(rankItems).mockResolvedValueOnce([mockSnippets[0]]); // initial search for "work"
      await snippetViewState.setSearch('work');

      snippetStore.snippets = [...mockSnippets, created];
      vi.mocked(rankItems).mockResolvedValueOnce([mockSnippets[0], created]); // re-rank includes the new item

      await snippetViewState.selectAfterMutation('new');

      expect(rankItems).toHaveBeenCalledTimes(2);
      expect(snippetViewState.selectedSnippet?.id).toBe('new');
    });

    it('leaves selection at -1 when the mutated item does not match the active filter', async () => {
      vi.mocked(rankItems).mockResolvedValueOnce([mockSnippets[0]]);
      await snippetViewState.setSearch('work');

      vi.mocked(rankItems).mockResolvedValueOnce([mockSnippets[0]]); // re-rank still excludes 'unrelated'
      await snippetViewState.selectAfterMutation('unrelated-id');

      expect(snippetViewState.selectedSnippet?.id).not.toBe('unrelated-id');
    });
  });

  describe('selectItem(index)', () => {
    it('updates selectedIndex and sets mode to view', () => {
      snippetViewState.mode = 'edit';
      snippetViewState.selectItem(1);
      expect(snippetViewState.selectedIndex).toBe(1);
      expect(snippetViewState.mode).toBe('view');
    });
  });

  describe('moveSelection(dir)', () => {
    it('wraps cyclically for down', () => {
      snippetViewState.selectItem(2);
      snippetViewState.moveSelection('down');
      expect(snippetViewState.selectedIndex).toBe(0);
    });

    it('wraps cyclically for up', () => {
      snippetViewState.selectItem(0);
      snippetViewState.moveSelection('up');
      expect(snippetViewState.selectedIndex).toBe(2);
    });

    it('sets mode to view', () => {
      snippetViewState.mode = 'edit';
      snippetViewState.moveSelection('down');
      expect(snippetViewState.mode).toBe('view');
    });

    it('noop when no items', () => {
      snippetStore.snippets = [];
      snippetViewState.moveSelection('down');
      expect(snippetViewState.selectedIndex).toBe(-1);
    });
  });

  describe('startCreate()', () => {
    it('sets mode to create and editingSnippet to null', () => {
      snippetViewState.mode = 'view';
      snippetViewState.editingSnippet = mockSnippets[0];
      snippetViewState.startCreate();
      expect(snippetViewState.mode).toBe('create');
      expect(snippetViewState.editingSnippet).toBe(null);
    });
  });

  describe('startEdit(snippet)', () => {
    it('sets mode to edit and sets editingSnippet', () => {
      snippetViewState.mode = 'view';
      snippetViewState.startEdit(mockSnippets[1]);
      expect(snippetViewState.mode).toBe('edit');
      expect(snippetViewState.editingSnippet).toEqual(mockSnippets[1]);
    });
  });

  describe('cancelEdit()', () => {
    it('sets mode to view and editingSnippet to null', () => {
      snippetViewState.mode = 'edit';
      snippetViewState.editingSnippet = mockSnippets[0];
      snippetViewState.cancelEdit();
      expect(snippetViewState.mode).toBe('view');
      expect(snippetViewState.editingSnippet).toBe(null);
    });
  });

  describe('reset()', () => {
    it('resets everything to initial state', async () => {
      vi.mocked(rankItems).mockResolvedValueOnce([mockSnippets[0]]);
      await snippetViewState.setSearch('work');
      snippetViewState.selectItem(2);
      snippetViewState.mode = 'edit';
      snippetViewState.editingSnippet = mockSnippets[0];
      snippetViewState.pendingDeleteId = '123';

      snippetViewState.reset();

      expect(snippetViewState.searchQuery).toBe('');
      expect(snippetViewState.selectedIndex).toBe(0);
      expect(snippetViewState.mode).toBe('view');
      expect(snippetViewState.editingSnippet).toBe(null);
      expect(snippetViewState.pendingDeleteId).toBe(null);
      // After reset, the full list is shown again with no active search.
      expect(snippetViewState.getFilteredSnippets()).toHaveLength(3);
    });
  });

  describe('selectedSnippet getter', () => {
    it('returns correct item for current index', () => {
      snippetViewState.selectItem(1);
      expect(snippetViewState.selectedSnippet?.id).toBe('2');
    });

    it('rejects an out-of-range index and stays at the auto-selected first item', () => {
      snippetViewState.selectItem(10);
      expect(snippetViewState.selectedSnippet?.id).toBe('1');
    });

    it('returns null if no items', () => {
      snippetStore.snippets = [];
      expect(snippetViewState.selectedSnippet).toBe(null);
    });
  });

  describe('pinned sorting', () => {
    it('getFilteredSnippets() returns pinned snippets before unpinned ones', () => {
      snippetStore.snippets = [
        { id: '1', name: 'A', keyword: ';a', expansion: 'a', createdAt: 1, pinned: false },
        { id: '2', name: 'B', keyword: ';b', expansion: 'b', createdAt: 2, pinned: true },
        { id: '3', name: 'C', keyword: ';c', expansion: 'c', createdAt: 3, pinned: false },
      ] as any;

      const results = snippetViewState.getFilteredSnippets();
      expect(results[0].id).toBe('2'); // Pinned
      expect(results[1].id).toBe('1');
      expect(results[2].id).toBe('3');
    });

    it('floats pinned items within the ranked result set', async () => {
      snippetStore.snippets = [
        { id: '1', name: 'A', keyword: ';a', expansion: 'a', createdAt: 1, pinned: false },
        { id: '2', name: 'B', keyword: ';b', expansion: 'b', createdAt: 2, pinned: true },
        { id: '3', name: 'C', keyword: ';c', expansion: 'c', createdAt: 3, pinned: false },
      ] as any;
      // Rust ranks C, B, A; pinned B floats to the front, rest keep Rust order.
      vi.mocked(rankItems).mockResolvedValueOnce([
        snippetStore.snippets[2],
        snippetStore.snippets[1],
        snippetStore.snippets[0],
      ]);
      await snippetViewState.setSearch('x');
      const results = snippetViewState.getFilteredSnippets();
      expect(results.map((s) => s.id)).toEqual(['2', '3', '1']);
    });

    it('pinnedCount counts pinned items in the visible result set', async () => {
      snippetStore.snippets = [
        { id: '1', name: 'A', keyword: ';a', expansion: 'a', createdAt: 1, pinned: true },
        { id: '2', name: 'B', keyword: ';b', expansion: 'b', createdAt: 2, pinned: true },
        { id: '3', name: 'C', keyword: ';c', expansion: 'c', createdAt: 3, pinned: false },
      ] as any;

      expect((snippetViewState as any).pinnedCount).toBe(2);

      vi.mocked(rankItems).mockResolvedValueOnce([snippetStore.snippets[2]]); // only C
      await snippetViewState.setSearch('C');
      expect((snippetViewState as any).pinnedCount).toBe(0);
    });
  });
});
