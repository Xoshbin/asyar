import { writable, get } from 'svelte/store';

export interface ItemShortcut {
  id: string;           
  objectId: string;     
  itemName: string;
  itemType: 'application' | 'command';
  itemPath?: string;    
  shortcut: string;     
  createdAt: number;
}

const STORAGE_KEY = 'asyar:item-shortcuts';

function loadFromStorage(): ItemShortcut[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
    return [];
  } catch {
    return [];
  }
}

function saveToStorage(shortcuts: ItemShortcut[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcuts));
}

function createShortcutStore() {
  const store = writable<ItemShortcut[]>(loadFromStorage());
  return {
    subscribe: store.subscribe,
    getAll: (): ItemShortcut[] => get(store),
    getByObjectId: (objectId: string): ItemShortcut | undefined => get(store).find(s => s.objectId === objectId),
    add: (shortcut: ItemShortcut) => {
      store.update(list => {
        const updated = [...list.filter(s => s.objectId !== shortcut.objectId), shortcut];
        saveToStorage(updated);
        return updated;
      });
    },
    update: (objectId: string, changes: Partial<ItemShortcut>) => {
      store.update(list => {
        const updated = list.map(s => s.objectId === objectId ? { ...s, ...changes } : s);
        saveToStorage(updated);
        return updated;
      });
    },
    remove: (objectId: string) => {
      store.update(list => {
        const updated = list.filter(s => s.objectId !== objectId);
        saveToStorage(updated);
        return updated;
      });
    },
  };
}

export const shortcutStore = createShortcutStore();
