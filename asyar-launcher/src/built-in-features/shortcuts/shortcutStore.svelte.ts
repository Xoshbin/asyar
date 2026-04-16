import {
  shortcutUpsert,
  shortcutGetAll,
  shortcutRemove,
} from '../../lib/ipc/commands';
import { envService } from '../../services/envService';
import { logService } from '../../services/log/logService';

export interface ItemShortcut {
  id: string;
  objectId: string;
  itemName: string;
  itemType: 'application' | 'command';
  itemPath?: string;
  shortcut: string;
  createdAt: number;
}

class ShortcutStoreClass {
  shortcuts = $state<ItemShortcut[]>([]);
  isCapturing = $state(false);
  #initialized = false;

  async init() {
    if (this.#initialized) return;
    this.#initialized = true;

    if (!envService.isTauri) return;

    try {
      const data = await shortcutGetAll();
      this.shortcuts = data as ItemShortcut[];
    } catch {
      // Keep empty default
    }
  }

  getAll(): ItemShortcut[] {
    return this.shortcuts;
  }

  getByObjectId(objectId: string): ItemShortcut | undefined {
    return this.shortcuts.find(s => s.objectId === objectId);
  }

  add(shortcut: ItemShortcut) {
    this.shortcuts = [...this.shortcuts.filter(s => s.objectId !== shortcut.objectId), shortcut];
    if (envService.isTauri) {
      shortcutUpsert(shortcut as any).catch(err => {
        logService.debug(`[ShortcutStore] Failed to persist shortcut: ${err}`);
      });
    }
  }

  update(objectId: string, changes: Partial<ItemShortcut>) {
    this.shortcuts = this.shortcuts.map(s => s.objectId === objectId ? { ...s, ...changes } : s);
    if (envService.isTauri) {
      const updated = this.shortcuts.find(s => s.objectId === objectId);
      if (updated) shortcutUpsert(updated as any).catch(err => {
        logService.debug(`[ShortcutStore] Failed to persist shortcut: ${err}`);
      });
    }
  }

  remove(objectId: string) {
    this.shortcuts = this.shortcuts.filter(s => s.objectId !== objectId);
    if (envService.isTauri) {
      shortcutRemove(objectId).catch(err => {
        logService.debug(`[ShortcutStore] Failed to remove shortcut: ${err}`);
      });
    }
  }

  async reload() {
    this.#initialized = false;
    await this.init();
  }
}

export const shortcutStore = new ShortcutStoreClass();
