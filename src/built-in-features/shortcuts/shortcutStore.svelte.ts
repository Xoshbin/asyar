import { listen, type UnlistenFn } from '@tauri-apps/api/event';
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
  #changedUnlisten: UnlistenFn | null = null;
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

    // Cross-webview sync: Rust fires `shortcuts:changed` after every
    // `shortcut_upsert` / `shortcut_remove` so each webview's in-memory
    // cache stays current. Without this, a shortcut bound from the
    // onboarding webview never lands in the main launcher's lookup, and
    // pressing the hotkey logs "Received shortcut for unknown objectId"
    // because handleFiredShortcut sees a stale empty list.
    try {
      this.#changedUnlisten = await listen('shortcuts:changed', () => {
        void this.reload();
      });
    } catch (err) {
      logService.warn(`[ShortcutStore] failed to subscribe shortcuts:changed: ${err}`);
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

/**
 * Split a list of shortcuts into the two sections rendered by the dedicated
 * shortcuts view. Pure function — does not touch the store.
 *
 * `ItemShortcut.itemType` is statically `'application' | 'command'` today;
 * an unexpected value is bucketed as a command (catch-all) so a future
 * union expansion does not silently drop rows from the view.
 */
export function groupShortcutsBySection(
  items: ItemShortcut[]
): { applications: ItemShortcut[]; commands: ItemShortcut[] } {
  const applications: ItemShortcut[] = [];
  const commands: ItemShortcut[] = [];
  for (const item of items) {
    if (item.itemType === 'application') {
      applications.push(item);
    } else {
      commands.push(item);
    }
  }
  return { applications, commands };
}
