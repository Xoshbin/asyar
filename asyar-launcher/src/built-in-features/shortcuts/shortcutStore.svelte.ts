import { createPersistence } from '../../lib/persistence/extensionStore';

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

class ShortcutStoreClass {
  shortcuts = $state<ItemShortcut[]>([]);
  isCapturing = $state(false);
  #initialized = false;

  constructor() {
    // Sync load from localStorage
    this.shortcuts = persistence.loadSync([]);
  }

  async init() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.shortcuts = await persistence.load([]);
  }

  getAll(): ItemShortcut[] {
    return this.shortcuts;
  }

  getByObjectId(objectId: string): ItemShortcut | undefined {
    return this.shortcuts.find(s => s.objectId === objectId);
  }

  add(shortcut: ItemShortcut) {
    this.shortcuts = [...this.shortcuts.filter(s => s.objectId !== shortcut.objectId), shortcut];
    persistence.save(this.shortcuts);
  }

  update(objectId: string, changes: Partial<ItemShortcut>) {
    this.shortcuts = this.shortcuts.map(s => s.objectId === objectId ? { ...s, ...changes } : s);
    persistence.save(this.shortcuts);
  }

  remove(objectId: string) {
    this.shortcuts = this.shortcuts.filter(s => s.objectId !== objectId);
    persistence.save(this.shortcuts);
  }
}

export const shortcutStore = new ShortcutStoreClass();
