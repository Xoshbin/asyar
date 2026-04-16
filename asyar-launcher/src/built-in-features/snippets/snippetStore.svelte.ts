import {
  snippetUpsert,
  snippetGetAll,
  snippetRemove,
  snippetTogglePin,
  snippetClearAll,
} from '../../lib/ipc/commands';
import { envService } from '../../services/envService';
import { logService } from '../../services/log/logService';

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
      snippetUpsert(snippet as any).catch(err => {
        logService.debug(`[SnippetStore] Failed to persist snippet: ${err}`);
      });
    }
  }

  update(id: string, changes: Partial<Snippet>) {
    this.snippets = this.snippets.map(s => s.id === id ? { ...s, ...changes } : s);
    if (envService.isTauri) {
      const updated = this.snippets.find(s => s.id === id);
      if (updated) snippetUpsert(updated as any).catch(err => {
        logService.debug(`[SnippetStore] Failed to persist snippet: ${err}`);
      });
    }
  }

  remove(id: string) {
    this.snippets = this.snippets.filter(s => s.id !== id);
    if (envService.isTauri) {
      snippetRemove(id).catch(err => {
        logService.debug(`[SnippetStore] Failed to remove snippet: ${err}`);
      });
    }
  }

  togglePin(id: string) {
    this.snippets = this.snippets.map(s => s.id === id ? { ...s, pinned: !s.pinned } : s);
    if (envService.isTauri) {
      snippetTogglePin(id).catch(err => {
        logService.debug(`[SnippetStore] Failed to toggle pin: ${err}`);
      });
    }
  }

  clearAll() {
    this.snippets = [];
    if (envService.isTauri) {
      snippetClearAll().catch(err => {
        logService.debug(`[SnippetStore] Failed to clear all snippets: ${err}`);
      });
    }
  }

  async reload() {
    this.#initialized = false;
    await this.init();
  }
}

export const snippetStore = new SnippetStoreClass();
