import { writable, get, type Unsubscriber } from 'svelte/store';
import { createPersistence } from '../../lib/persistence/extensionStore';

export const isCapturingShortcut = writable<boolean>(false);

export interface ItemShortcut {
  id: string;           
  objectId: string;     
  itemName: string;
  itemType: 'application' | 'command';
  itemPath?: string;    
  shortcut: string;     
  createdAt: number;
}

const persistence = createPersistence<ItemShortcut[]>('asyar:item-shortcuts', 'shortcuts.dat');

function createShortcutStore() {
  // Initialize synchronously from localStorage (fast, non-blocking)
  const store = writable<ItemShortcut[]>(persistence.loadSync([]));
  let initialized = false;

  async function init() {
    if (initialized) return;
    initialized = true;
    const data = await persistence.load([]);
    store.set(data);
  }

  const originalSubscribe = store.subscribe;
  let initPromise: Promise<void> | null = null;

  return {
    subscribe: (run: (value: ItemShortcut[]) => void, invalidate?: (value?: ItemShortcut[]) => void): Unsubscriber => {
      if (!initPromise) initPromise = init();
      return originalSubscribe(run, invalidate);
    },
    getAll: (): ItemShortcut[] => get(store),
    getByObjectId: (objectId: string): ItemShortcut | undefined => get(store).find(s => s.objectId === objectId),
    add: (shortcut: ItemShortcut) => {
      store.update(list => {
        const updated = [...list.filter(s => s.objectId !== shortcut.objectId), shortcut];
        persistence.save(updated);
        return updated;
      });
    },
    update: (objectId: string, changes: Partial<ItemShortcut>) => {
      store.update(list => {
        const updated = list.map(s => s.objectId === objectId ? { ...s, ...changes } : s);
        persistence.save(updated);
        return updated;
      });
    },
    remove: (objectId: string) => {
      store.update(list => {
        const updated = list.filter(s => s.objectId !== objectId);
        persistence.save(updated);
        return updated;
      });
    },
  };
}

export const shortcutStore = createShortcutStore();
