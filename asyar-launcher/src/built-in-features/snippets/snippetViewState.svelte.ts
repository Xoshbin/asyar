import { snippetStore, type Snippet } from './snippetStore.svelte';
import { SearchEngine } from 'asyar-sdk/contracts';
import { useListSelection } from '../../lib/listSelection.svelte';

export type SnippetEditMode = 'view' | 'edit' | 'create';

class SnippetViewStateClass {
  searchQuery = $state('');
  mode = $state<SnippetEditMode>('view');
  editingSnippet = $state<Snippet | null>(null);
  pendingDeleteId = $state<string | null>(null); // set by triggerDelete(), watched by DefaultView

  private searchEngine = new SearchEngine<Snippet>({
    getText: (s) => `${s.name} ${s.keyword ?? ''} ${s.expansion}`,
  });

  private selection = useListSelection({ items: () => this.getFilteredSnippets() });

  get selectedIndex(): number {
    return this.selection.selectedIndex;
  }

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
    return this.selection.selectedItem;
  }

  setSearch(query: string) {
    this.searchQuery = query;
    this.selection.setIndex(0);
    if (this.mode !== 'create' && this.mode !== 'edit') this.mode = 'view';
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
    this.selection.setIndex(0);
    this.mode = 'view';
    this.editingSnippet = null;
    this.pendingDeleteId = null;
  }
}

export const snippetViewState = new SnippetViewStateClass();
