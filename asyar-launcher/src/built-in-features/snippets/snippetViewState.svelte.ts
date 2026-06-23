import { snippetStore, type Snippet } from './snippetStore.svelte';
import { rankItems } from '../../lib/rankItems';
import { useListSelection } from '../../lib/listSelection.svelte';

export type SnippetEditMode = 'view' | 'edit' | 'create';

class SnippetViewStateClass {
  searchQuery = $state('');
  mode = $state<SnippetEditMode>('view');
  editingSnippet = $state<Snippet | null>(null);
  pendingDeleteId = $state<string | null>(null); // set by triggerDelete(), watched by DefaultView

  // Ids of the current search results, best-match first, as ranked by Rust.
  // `null` means no active search (show the full list). Held as ids — not item
  // refs — so pin toggles and edits re-derive against the live store.
  private rankedIds = $state<string[] | null>(null);

  private selection = useListSelection({ items: () => this.getFilteredSnippets() });

  get selectedIndex(): number {
    return this.selection.selectedIndex;
  }

  getFilteredSnippets(): Snippet[] {
    const all = snippetStore.snippets || [];
    const q = this.searchQuery.trim();

    let searched: Snippet[];
    if (!q || this.rankedIds === null) {
      searched = all;
    } else {
      const byId = new Map(all.map(s => [s.id, s]));
      searched = this.rankedIds
        .map(id => byId.get(id))
        .filter((s): s is Snippet => s !== undefined);
    }

    const pinned = searched.filter(s => s.pinned);
    const rest = searched.filter(s => !s.pinned);
    return [...pinned, ...rest];
  }

  get pinnedCount(): number {
    return this.getFilteredSnippets().filter(s => s.pinned).length;
  }

  get selectedSnippet(): Snippet | null {
    return this.selection.selectedItem;
  }

  async setSearch(query: string) {
    this.searchQuery = query;
    this.selection.setIndex(0);
    if (this.mode !== 'create' && this.mode !== 'edit') this.mode = 'view';

    const q = query.trim();
    if (!q) {
      this.rankedIds = null;
      return;
    }

    const ranked = await rankItems(q, snippetStore.snippets || [], {
      id: s => s.id,
      title: s => s.name,
      subtitle: s => s.expansion,
      keywords: s => (s.keyword ? [s.keyword] : []),
    });

    // Guard against out-of-order responses: a newer keystroke may have
    // superseded this query while Rust was ranking.
    if (this.searchQuery.trim() !== q) return;
    this.rankedIds = ranked.map(s => s.id);
  }

  /**
   * Select the snippet with this id, re-ranking against the live store first
   * if a search is active. `rankedIds` is a snapshot from the last Rust call,
   * so it predates any item created/duplicated since — without the re-rank,
   * a brand-new item that matches the active filter would not be found.
   */
  async selectAfterMutation(id: string) {
    if (this.searchQuery.trim()) {
      await this.setSearch(this.searchQuery);
    }
    const idx = this.getFilteredSnippets().findIndex(s => s.id === id);
    if (idx >= 0) this.selectItem(idx);
  }

  selectItem(index: number) {
    this.selection.setIndex(index);
    this.mode = 'view';
  }

  moveSelection(dir: 'up' | 'down') {
    this.selection.moveSelection(dir);
    this.mode = 'view';
  }

  startCreate() {
    this.mode = 'create';
    this.editingSnippet = null;
  }

  startEdit(snippet: Snippet) {
    this.mode = 'edit';
    this.editingSnippet = snippet;
  }

  cancelEdit() {
    this.mode = 'view';
    this.editingSnippet = null;
  }

  triggerDelete() {
    this.pendingDeleteId = this.selectedSnippet?.id ?? null;
  }

  reset() {
    this.searchQuery = '';
    this.rankedIds = null;
    this.selection.setIndex(0);
    this.mode = 'view';
    this.editingSnippet = null;
    this.pendingDeleteId = null;
  }
}

export const snippetViewState = new SnippetViewStateClass();
