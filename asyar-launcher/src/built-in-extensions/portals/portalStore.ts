import { writable, get } from 'svelte/store';

export interface Portal {
  id: string;
  name: string;
  url: string;
  icon: string;
  createdAt: number;
}

const STORAGE_KEY = 'asyar:portals';

const DEFAULT_PORTALS: Omit<Portal, 'id' | 'createdAt'>[] = [
  { name: 'Search Google',    url: 'https://google.com/search?q={query}',  icon: '🌐' },
  { name: 'Search GitHub',    url: 'https://github.com/search?q={query}',  icon: '🐙' },
  { name: 'Search Wikipedia', url: 'https://en.wikipedia.org/wiki/{query}', icon: '📖' },
];

function loadFromStorage(): Portal[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
    // First run — seed defaults
    const seeded = DEFAULT_PORTALS.map(p => ({
      ...p,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  } catch {
    return [];
  }
}

function saveToStorage(portals: Portal[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(portals));
}

function createPortalStore() {
  const store = writable<Portal[]>(loadFromStorage());
  return {
    subscribe: store.subscribe,
    getAll: (): Portal[] => get(store),
    getById: (id: string): Portal | undefined => get(store).find(p => p.id === id),
    add: (portal: Portal) => {
      store.update(list => {
        const updated = [...list, portal];
        saveToStorage(updated);
        return updated;
      });
    },
    update: (id: string, changes: Partial<Portal>) => {
      store.update(list => {
        const updated = list.map(p => p.id === id ? { ...p, ...changes } : p);
        saveToStorage(updated);
        return updated;
      });
    },
    remove: (id: string) => {
      store.update(list => {
        const updated = list.filter(p => p.id !== id);
        saveToStorage(updated);
        return updated;
      });
    },
  };
}

export const portalStore = createPortalStore();
