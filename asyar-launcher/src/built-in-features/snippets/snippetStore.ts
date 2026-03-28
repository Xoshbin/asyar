import { writable, get, type Unsubscriber } from 'svelte/store';
import { createPersistence } from '../../lib/persistence/extensionStore';

export interface Snippet {
  id: string;
  keyword: string;    // e.g. ";addr" — what the user types (lowercase + symbols)
  expansion: string;  // e.g. "123 Main St, Springfield"
  name: string;       // display label
  createdAt: number;
}

const persistence = createPersistence<Snippet[]>('asyar:snippets', 'snippets.dat');

function createSnippetStore() {
  // Initialize synchronously from localStorage (fast, non-blocking)
  const store = writable<Snippet[]>(persistence.loadSync([]));
  let initialized = false;

  // Async init: load from Tauri store (migrates localStorage data if needed)
  async function init() {
    if (initialized) return;
    initialized = true;
    const data = await persistence.load([]);
    store.set(data);
  }

  // Auto-init on first subscribe
  const originalSubscribe = store.subscribe;
  let initPromise: Promise<void> | null = null;

  return {
    subscribe: (run: (value: Snippet[]) => void, invalidate?: (value?: Snippet[]) => void): Unsubscriber => {
      if (!initPromise) initPromise = init();
      return originalSubscribe(run, invalidate);
    },
    getAll: (): Snippet[] => get(store),
    add: (snippet: Snippet) => {
      store.update(list => {
        const updated = [...list.filter(s => s.id !== snippet.id), snippet];
        persistence.save(updated);
        return updated;
      });
    },
    update: (id: string, changes: Partial<Snippet>) => {
      store.update(list => {
        const updated = list.map(s => s.id === id ? { ...s, ...changes } : s);
        persistence.save(updated);
        return updated;
      });
    },
    remove: (id: string) => {
      store.update(list => {
        const updated = list.filter(s => s.id !== id);
        persistence.save(updated);
        return updated;
      });
    },
  };
}

export const snippetStore = createSnippetStore();
