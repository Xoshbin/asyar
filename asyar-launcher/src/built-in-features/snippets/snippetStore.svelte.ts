import { createPersistence } from '../../lib/persistence/extensionStore';

export interface Snippet {
  id: string;
  keyword: string;    // e.g. ";addr" — what the user types (lowercase + symbols)
  expansion: string;  // e.g. "123 Main St, Springfield"
  name: string;       // display label
  createdAt: number;
  pinned?: boolean;
}

const persistence = createPersistence<Snippet[]>('asyar:snippets', 'snippets.dat');

class SnippetStoreClass {
  snippets = $state<Snippet[]>([]);
  #initialized = false;

  constructor() {
    this.snippets = persistence.loadSync([]);
  }

  async init() {
    if (this.#initialized) return;
    this.#initialized = true;
    const data = await persistence.load([]);
    this.snippets = data;
  }

  getAll(): Snippet[] {
    return this.snippets;
  }

  add(snippet: Snippet) {
    this.snippets = [...this.snippets.filter(s => s.id !== snippet.id), snippet];
    persistence.save($state.snapshot(this.snippets) as Snippet[]);
  }

  update(id: string, changes: Partial<Snippet>) {
    this.snippets = this.snippets.map(s => s.id === id ? { ...s, ...changes } : s);
    persistence.save($state.snapshot(this.snippets) as Snippet[]);
  }

  remove(id: string) {
    this.snippets = this.snippets.filter(s => s.id !== id);
    persistence.save($state.snapshot(this.snippets) as Snippet[]);
  }

  togglePin(id: string) {
    this.snippets = this.snippets.map(s => s.id === id ? { ...s, pinned: !s.pinned } : s);
    persistence.save($state.snapshot(this.snippets) as Snippet[]);
  }
}

export const snippetStore = new SnippetStoreClass();
