import {
  snippetUpsert,
  snippetGetAll,
  snippetRemove,
  snippetTogglePin,
  snippetClearAll,
} from '../../lib/ipc/commands';
import { envService } from '../../services/envService';

export interface Snippet {
  id: string;
  keyword?: string;   // e.g. ";addr" — what the user types (lowercase + symbols); optional
  expansion: string;  // e.g. "123 Main St, Springfield"
  name: string;       // display label
  createdAt: number;
  pinned?: boolean;
}

class SnippetStoreClass {
  snippets = $state<Snippet[]>([]);
  #initialized = false;

  async init() {
    if (this.#initialized) return;
    this.#initialized = true;

    if (!envService.isTauri) return;

    try {
      const data = await snippetGetAll();
      this.snippets = data as Snippet[];
    } catch {
      // Keep empty default
    }
  }

  getAll(): Snippet[] {
    return this.snippets;
  }

  add(snippet: Snippet) {
    this.snippets = [...this.snippets.filter(s => s.id !== snippet.id), snippet];
    if (envService.isTauri) {
      snippetUpsert(snippet as any).catch(() => {});
    }
  }

  update(id: string, changes: Partial<Snippet>) {
    this.snippets = this.snippets.map(s => s.id === id ? { ...s, ...changes } : s);
    if (envService.isTauri) {
      const updated = this.snippets.find(s => s.id === id);
      if (updated) snippetUpsert(updated as any).catch(() => {});
    }
  }

  remove(id: string) {
    this.snippets = this.snippets.filter(s => s.id !== id);
    if (envService.isTauri) {
      snippetRemove(id).catch(() => {});
    }
  }

  togglePin(id: string) {
    this.snippets = this.snippets.map(s => s.id === id ? { ...s, pinned: !s.pinned } : s);
    if (envService.isTauri) {
      snippetTogglePin(id).catch(() => {});
    }
  }

  clearAll() {
    this.snippets = [];
    if (envService.isTauri) {
      snippetClearAll().catch(() => {});
    }
  }
}

export const snippetStore = new SnippetStoreClass();
