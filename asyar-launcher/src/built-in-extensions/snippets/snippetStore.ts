import { writable, get } from 'svelte/store';

export interface Snippet {
  id: string;
  keyword: string;    // e.g. ";addr" — what the user types (lowercase + symbols)
  expansion: string;  // e.g. "123 Main St, Springfield"
  name: string;       // display label
  createdAt: number;
}

const STORAGE_KEY = 'asyar:snippets';

function loadFromStorage(): Snippet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
    return [];
  } catch {
    return [];
  }
}

function saveToStorage(snippets: Snippet[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets));
}

function createSnippetStore() {
  const store = writable<Snippet[]>(loadFromStorage());
  return {
    subscribe: store.subscribe,
    getAll: (): Snippet[] => get(store),
    add: (snippet: Snippet) => {
      store.update(list => {
        const updated = [...list.filter(s => s.id !== snippet.id), snippet];
        saveToStorage(updated);
        return updated;
      });
    },
    update: (id: string, changes: Partial<Snippet>) => {
      store.update(list => {
        const updated = list.map(s => s.id === id ? { ...s, ...changes } : s);
        saveToStorage(updated);
        return updated;
      });
    },
    remove: (id: string) => {
      store.update(list => {
        const updated = list.filter(s => s.id !== id);
        saveToStorage(updated);
        return updated;
      });
    },
  };
}

export const snippetStore = createSnippetStore();
