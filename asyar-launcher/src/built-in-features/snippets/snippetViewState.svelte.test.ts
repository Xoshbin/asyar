/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { snippetViewState } from './snippetViewState.svelte';
import { snippetStore } from './snippetStore.svelte';

vi.mock('./snippetStore.svelte', () => ({
  snippetStore: { snippets: [] }
}));

const mockSnippets = [
  { id: '1', name: 'Work Email', keyword: ';email', expansion: 'work@example.com', createdAt: Date.now() },
  { id: '2', name: 'Home Address', keyword: ';addr', expansion: '123 Main St', createdAt: Date.now() },
  { id: '3', name: 'Z-Snippet', keyword: ';zz', expansion: 'expansion of z', createdAt: Date.now() }
];

describe('snippetViewState', () => {
  beforeEach(() => {
    snippetViewState.reset();
    snippetStore.snippets = [...mockSnippets];
  });

  describe('getFilteredSnippets()', () => {
    it('returns all when no query', () => {
      expect(snippetViewState.getFilteredSnippets()).toHaveLength(3);
    });

    it('filters by name', () => {
      snippetViewState.setSearch('work');
      const filtered = snippetViewState.getFilteredSnippets();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('Work Email');
    });

    it('filters by keyword', () => {
      snippetViewState.setSearch(';addr');
      const filtered = snippetViewState.getFilteredSnippets();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].keyword).toBe(';addr');
    });

    it('filters by expansion', () => {
      snippetViewState.setSearch('Main St');
      const filtered = snippetViewState.getFilteredSnippets();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('Home Address');
    });

    it('is case insensitive', () => {
      snippetViewState.setSearch('WORK');
      expect(snippetViewState.getFilteredSnippets()).toHaveLength(1);
    });
  });

  describe('setSearch(query)', () => {
    it('updates searchQuery and resets selectedIndex', () => {
      snippetViewState.selectedIndex = 2;
      snippetViewState.setSearch('new query');
      expect(snippetViewState.searchQuery).toBe('new query');
      expect(snippetViewState.selectedIndex).toBe(0);
    });

    it('keeps edit mode if already in it', () => {
      snippetViewState.mode = 'edit';
      snippetViewState.setSearch('test');
      expect(snippetViewState.mode).toBe('edit');
    });

    it('keeps create mode if already in it', () => {
      snippetViewState.mode = 'create';
      snippetViewState.setSearch('test');
      expect(snippetViewState.mode).toBe('create');
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
      snippetViewState.selectedIndex = 2;
      snippetViewState.moveSelection('down');
      expect(snippetViewState.selectedIndex).toBe(0);
    });

    it('wraps cyclically for up', () => {
      snippetViewState.selectedIndex = 0;
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
      snippetViewState.selectedIndex = 0;
      snippetViewState.moveSelection('down');
      expect(snippetViewState.selectedIndex).toBe(0);
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
    it('resets everything to initial state', () => {
      snippetViewState.searchQuery = 'test';
      snippetViewState.selectedIndex = 5;
      snippetViewState.mode = 'edit';
      snippetViewState.editingSnippet = mockSnippets[0];
      snippetViewState.pendingDeleteId = '123';

      snippetViewState.reset();

      expect(snippetViewState.searchQuery).toBe('');
      expect(snippetViewState.selectedIndex).toBe(0);
      expect(snippetViewState.mode).toBe('view');
      expect(snippetViewState.editingSnippet).toBe(null);
      expect(snippetViewState.pendingDeleteId).toBe(null);
    });
  });

  describe('selectedSnippet getter', () => {
    it('returns correct item for current index', () => {
      snippetViewState.selectedIndex = 1;
      expect(snippetViewState.selectedSnippet?.id).toBe('2');
    });

    it('returns null if out of range', () => {
      snippetViewState.selectedIndex = 10;
      expect(snippetViewState.selectedSnippet).toBe(null);
    });

    it('returns null if no items', () => {
      snippetStore.snippets = [];
      snippetViewState.selectedIndex = 0;
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

    it('pinnedCount returns correct count of pinned items in filtered results', () => {
      snippetStore.snippets = [
        { id: '1', name: 'A', keyword: ';a', expansion: 'a', createdAt: 1, pinned: true },
        { id: '2', name: 'B', keyword: ';b', expansion: 'b', createdAt: 2, pinned: true },
        { id: '3', name: 'C', keyword: ';c', expansion: 'c', createdAt: 3, pinned: false },
      ] as any;

      expect((snippetViewState as any).pinnedCount).toBe(2);
      
      snippetViewState.setSearch('C');
      expect((snippetViewState as any).pinnedCount).toBe(0);
    });
  });
});
