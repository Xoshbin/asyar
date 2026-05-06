import {
  shortcutUpsert,
  shortcutGetAll,
  shortcutRemove,
} from '../../lib/ipc/commands';
import { logService } from '../../services/log/logService';
import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';

function reportPersistenceFailure(action: string, err: unknown): void {
  logService.error(`[ShortcutStore] ${action}: ${err}`);
  diagnosticsService.report({
    source: 'frontend', kind: 'manual', severity: 'warning',
    retryable: false,
    context: { message: `Shortcut ${action.toLowerCase()} — change may not survive restart` },
  });
}

export interface ItemShortcut {
  id: string;
  objectId: string;
  itemName: string;
  itemType: 'application' | 'command';
  itemPath?: string;
  itemIcon?: string;
  shortcut: string;
  createdAt: number;
}

/**
 * Local change event emitted by the store on add/update/remove. Used by
 * the cloud sync delta provider to mark items dirty for the next push.
 * Note: itemId here is the shortcut's `objectId` since that's the stable
 * key for shortcuts (not the surrogate `id`).
 */
export type ShortcutStoreChangeEvent =
  | { type: 'upsert'; itemId: string }
  | { type: 'delete'; itemId: string };

class ShortcutStoreClass {
  shortcuts = $state<ItemShortcut[]>([]);
  isCapturing = $state(false);
  #initialized = false;
  #subscribers = new Set<(event: ShortcutStoreChangeEvent) => void>();

  subscribe(callback: (event: ShortcutStoreChangeEvent) => void): () => void {
    this.#subscribers.add(callback);
    return () => {
      this.#subscribers.delete(callback);
    };
  }

  #notify(event: ShortcutStoreChangeEvent): void {
    this.#subscribers.forEach((cb) => {
      try {
        cb(event);
      } catch (err) {
        logService.warn(`shortcutStore subscriber threw: ${err}`);
      }
    });
  }

  async init() {
    if (this.#initialized) return;
    this.#initialized = true;

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
    shortcutUpsert(shortcut as any).catch(err => reportPersistenceFailure('Failed to save', err));
    this.#notify({ type: 'upsert', itemId: shortcut.objectId });
  }

  update(objectId: string, changes: Partial<ItemShortcut>) {
    this.shortcuts = this.shortcuts.map(s => s.objectId === objectId ? { ...s, ...changes } : s);
    const updated = this.shortcuts.find(s => s.objectId === objectId);
    if (updated) shortcutUpsert(updated as any).catch(err => reportPersistenceFailure('Failed to update', err));
    this.#notify({ type: 'upsert', itemId: objectId });
  }

  remove(objectId: string) {
    this.shortcuts = this.shortcuts.filter(s => s.objectId !== objectId);
    shortcutRemove(objectId).catch(err => reportPersistenceFailure('Failed to delete', err));
    this.#notify({ type: 'delete', itemId: objectId });
  }

  async reload() {
    this.#initialized = false;
    await this.init();
  }
}

export const shortcutStore = new ShortcutStoreClass();
