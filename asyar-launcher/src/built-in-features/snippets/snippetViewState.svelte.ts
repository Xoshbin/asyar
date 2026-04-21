import { snippetStore, type Snippet } from './snippetStore.svelte';
import { SearchEngine } from 'asyar-sdk/contracts';

export type SnippetEditMode = 'view' | 'edit' | 'create';

class SnippetViewStateClass {
  searchQuery = $state('');
  selectedIndex = $state(0);
  mode = $state<SnippetEditMode>('view');
  editingSnippet = $state<Snippet | null>(null);
  pendingDeleteId = $state<string | null>(null); // set by triggerDelete(), watched by DefaultView

  private searchEngine = new SearchEngine<Snippet>({
    getText: (s) => `${s.name} ${s.keyword ?? ''} ${s.expansion}`,
  });

  getFilteredSnippets(): Snippet[] {
    const q = this.searchQuery.trim();

    this.searchEngine.setItems(snippetStore.snippets || []);
    const searched = q ? this.searchEngine.search(q) : (snippetStore.snippets || []);

    const pinned = searched.filter(s => s.pinned);
    const rest = searched.filter(s => !s.pinned);
    return [...pinned, ...rest];
  }

  get pinnedCount(): number {
    return this.getFilteredSnippets().filter(s => s.pinned).length;
  }

  get selectedSnippet(): Snippet | null {
    const items = this.getFilteredSnippets();
    if (this.selectedIndex >= 0 && this.selectedIndex < items.length)
      return items[this.selectedIndex];
    return null;
  }

  setSearch(query: string) {
    this.searchQuery = query;
    this.selectedIndex = 0;
    if (this.mode !== 'create' && this.mode !== 'edit') this.mode = 'view';
  }

  selectItem(index: number) {
    this.selectedIndex = index;
    this.mode = 'view';
  }

  moveSelection(dir: 'up' | 'down') {
    const count = this.getFilteredSnippets().length;
    if (!count) return;
    this.selectedIndex = dir === 'up'
      ? (this.selectedIndex - 1 + count) % count
      : (this.selectedIndex + 1) % count;
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
    this.selectedIndex = 0;
    this.mode = 'view';
    this.editingSnippet = null;
    this.pendingDeleteId = null;
  }
}

export const snippetViewState = new SnippetViewStateClass();
