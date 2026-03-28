import { writable, get, type Unsubscriber } from 'svelte/store';
import { createPersistence } from '../../lib/persistence/extensionStore';

export interface Portal {
  id: string;
  name: string;
  url: string;
  icon: string;
  createdAt: number;
}

const DEFAULT_PORTALS: Omit<Portal, 'id' | 'createdAt'>[] = [
  { name: 'Search Google',    url: 'https://google.com/search?q={query}',  icon: '🌐' },
  { name: 'Search GitHub',    url: 'https://github.com/search?q={query}',  icon: '🐙' },
  { name: 'Search Wikipedia', url: 'https://en.wikipedia.org/wiki/{query}', icon: '📖' },
];

function seedDefaults(): Portal[] {
  return DEFAULT_PORTALS.map(p => ({
    ...p,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  }));
}

const persistence = createPersistence<Portal[]>('asyar:portals', 'portals.dat');

function createPortalStore() {
  // Sync load: check localStorage for existing data, seed defaults if empty
  const syncData = persistence.loadSync([]);
  const initialData = syncData.length > 0 ? syncData : seedDefaults();
  const store = writable<Portal[]>(initialData);
  let initialized = false;

  async function init() {
    if (initialized) return;
    initialized = true;
    let data = await persistence.load([]);
    if (data.length === 0) {
      data = seedDefaults();
      await persistence.save(data);
    }
    store.set(data);
  }

  const originalSubscribe = store.subscribe;
  let initPromise: Promise<void> | null = null;

  return {
    subscribe: (run: (value: Portal[]) => void, invalidate?: (value?: Portal[]) => void): Unsubscriber => {
      if (!initPromise) initPromise = init();
      return originalSubscribe(run, invalidate);
    },
    getAll: (): Portal[] => get(store),
    getById: (id: string): Portal | undefined => get(store).find(p => p.id === id),
    add: (portal: Portal) => {
      store.update(list => {
        const updated = [...list, portal];
        persistence.save(updated);
        return updated;
      });
    },
    update: (id: string, changes: Partial<Portal>) => {
      store.update(list => {
        const updated = list.map(p => p.id === id ? { ...p, ...changes } : p);
        persistence.save(updated);
        return updated;
      });
    },
    remove: (id: string) => {
      store.update(list => {
        const updated = list.filter(p => p.id !== id);
        persistence.save(updated);
        return updated;
      });
    },
  };
}

export const portalStore = createPortalStore();
