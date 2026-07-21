import { noteStore, type Note } from './noteStore.svelte';
import { noteSearch } from '../../lib/ipc/commands';
import { useListSelection } from '../../lib/listSelection.svelte';

class NoteViewStateClass {
  searchQuery = $state('');
  indexState = $state<'ready' | 'indexing'>('ready');

  // Ids of the current search results, best-match first, as ranked by the
  // Rust FTS5 index (title + body content, not just title). `null` means no
  // active search (show the full list). Held as ids — not item refs — so
  // edits/pins re-derive against the live store.
  private rankedIds = $state<string[] | null>(null);

  // Set right after "New Note" creates an empty note, so the detail pane
  // knows to autofocus the title field once. Cleared after the first read.
  justCreatedId = $state<string | null>(null);

  private selection = useListSelection({ items: () => this.getFilteredNotes() });

  get selectedIndex(): number {
    return this.selection.selectedIndex;
  }

  // Display-only selection — no sorting here. Ordering is Rust's job:
  // `note_get_all` returns pinned-first, newest-first; `note_search` returns
  // bm25 rank order. This just picks which Rust-ordered set to show.
  getFilteredNotes(): Note[] {
    const all = noteStore.notes || [];
    if (!this.searchQuery.trim() || this.rankedIds === null) return all;
    const byId = new Map(all.map((n) => [n.id, n]));
    return this.rankedIds.map((id) => byId.get(id)).filter((n): n is Note => n !== undefined);
  }

  // List mode only: Rust puts pinned notes first, so the leading `pinnedCount`
  // rows are the pinned ones — what the section dividers rely on. 0 while
  // searching (no dividers there).
  get pinnedCount(): number {
    if (this.searchQuery.trim()) return 0;
    return (noteStore.notes || []).filter((n) => n.pinned).length;
  }

  get selectedNote(): Note | null {
    return this.selection.selectedItem;
  }

  async setSearch(query: string) {
    this.searchQuery = query;
    this.selection.setIndex(0);

    const q = query.trim();
    if (!q) {
      this.rankedIds = null;
      this.indexState = 'ready';
      return;
    }

    const result = await noteSearch(q, 100);
    // Guard against out-of-order responses: a newer keystroke may have
    // superseded this query while Rust was searching.
    if (this.searchQuery.trim() !== q) return;

    this.indexState = result?.indexState ?? 'ready';
    this.rankedIds = (result?.items ?? []).map((n) => n.id);
  }

  /**
   * Select the note with this id, re-searching against the live store first
   * if a search is active. `rankedIds` is a snapshot from the last FTS
   * call, so it predates any note created/duplicated since — without the
   * re-search, a brand-new note that matches the active filter would not
   * be found.
   */
  async selectAfterMutation(id: string) {
    if (this.searchQuery.trim()) {
      await this.setSearch(this.searchQuery);
    }
    const idx = this.getFilteredNotes().findIndex((n) => n.id === id);
    if (idx >= 0) this.selection.setIndex(idx);
  }

  selectItem(index: number) {
    this.selection.setIndex(index);
  }

  /**
   * Create a blank note and select it. Shared by the root "New Note"
   * action, the in-view ⌘N shortcut, and the empty-state button — one
   * definition of what "new note" means.
   */
  async createNote() {
    const now = Date.now();
    const note: Note = {
      id: crypto.randomUUID(),
      title: '',
      body: '',
      createdAt: now,
      updatedAt: now,
      pinned: false,
    };
    noteStore.add(note);
    this.searchQuery = '';
    this.rankedIds = null;
    await this.selectAfterMutation(note.id);
    this.justCreatedId = note.id;
  }

  moveSelection(dir: 'up' | 'down') {
    this.selection.moveSelection(dir);
  }

  reset() {
    this.searchQuery = '';
    this.rankedIds = null;
    this.indexState = 'ready';
    this.justCreatedId = null;
    this.selection.setIndex(0);
  }
}

export const noteViewState = new NoteViewStateClass();
