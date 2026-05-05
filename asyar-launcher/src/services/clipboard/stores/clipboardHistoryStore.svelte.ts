import { logService } from "../../log/logService";
import type { ClipboardHistoryItem } from "asyar-sdk/contracts";
import {
  clipboardGetAll,
  clipboardToggleFavorite,
  clipboardDeleteItem,
  clipboardClearNonFavorites,
  clipboardRecordCapture,
  type StoredClipboardItem,
} from "../../../lib/ipc/commands";
import { envService } from "../../envService";

// Constants
const MAX_ITEMS = 1000;

/**
 * Convert SDK type to Rust-compatible stored type.
 * The types are structurally identical (both camelCase JSON),
 * but metadata needs to be a plain object for Rust serde_json::Value.
 */
function toStored(item: ClipboardHistoryItem): StoredClipboardItem {
  return item as unknown as StoredClipboardItem;
}

function fromStored(items: StoredClipboardItem[]): ClipboardHistoryItem[] {
  return items as unknown as ClipboardHistoryItem[];
}

/**
 * Local change event emitted by the store whenever an item is added,
 * favorited, deleted, or cleared. Consumed by the cloud sync provider
 * (see `clipboardSyncProvider.subscribeToChanges`) to mark items dirty
 * for the next push tick.
 */
export type ClipboardStoreChangeEvent =
  | { type: 'upsert'; itemId: string }
  | { type: 'delete'; itemId: string };

export class ClipboardHistoryStoreClass {
  items = $state<ClipboardHistoryItem[]>([]);
  private initialized = false;
  // Hand-rolled subscriber list — kept narrow so consumers can react to
  // local mutations without spinning up a Svelte $effect runtime. Used by
  // the cloud sync delta provider; not part of the broader UI contract.
  #subscribers = new Set<(event: ClipboardStoreChangeEvent) => void>();

  /** Subscribe to local change events. Returns an unsubscribe function. */
  subscribe(callback: (event: ClipboardStoreChangeEvent) => void): () => void {
    this.#subscribers.add(callback);
    return () => {
      this.#subscribers.delete(callback);
    };
  }

  #notify(event: ClipboardStoreChangeEvent): void {
    this.#subscribers.forEach((cb) => {
      try {
        cb(event);
      } catch (err) {
        logService.warn(`clipboardHistoryStore subscriber threw: ${err}`);
      }
    });
  }

  /**
   * Initialize the clipboard history store by loading all items from Rust SQLite.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    if (!envService.isTauri) return;

    try {
      const stored = await clipboardGetAll();
      this.items = fromStored(stored);
    } catch (error) {
      logService.error(`Failed to init clipboard history store: ${error}`);
    }
  }

  /**
   * Add an item to the clipboard history.
   * Delegates all dedup / insert / cleanup logic to the Rust `clipboard_record_capture` command.
   */
  async addHistoryItem(item: ClipboardHistoryItem): Promise<void> {
    if (!envService.isTauri) {
      // Non-Tauri fallback: in-memory only (no dedup, no cleanup)
      this.items = [item, ...this.items.filter(i => i.id !== item.id)].slice(0, MAX_ITEMS);
      this.#notify({ type: 'upsert', itemId: item.id });
      return;
    }

    try {
      const stored = await clipboardRecordCapture(toStored(item));
      this.items = fromStored(stored);
      this.#notify({ type: 'upsert', itemId: item.id });
    } catch (error) {
      logService.error(`Failed to record clipboard capture: ${error}`);
    }
  }

  /**
   * Get all clipboard history items.
   */
  async getHistoryItems(): Promise<ClipboardHistoryItem[]> {
    if (!envService.isTauri) return $state.snapshot(this.items) as ClipboardHistoryItem[];

    try {
      const stored = await clipboardGetAll();
      this.items = fromStored(stored);
      return $state.snapshot(this.items) as ClipboardHistoryItem[];
    } catch (error) {
      logService.error(`Failed to get clipboard history items: ${error}`);
      return $state.snapshot(this.items) as ClipboardHistoryItem[];
    }
  }

  /**
   * Toggle favorite status of an item.
   */
  async toggleFavorite(id: string): Promise<void> {
    if (!envService.isTauri) {
      this.items = this.items.map(item =>
        item.id === id ? { ...item, favorite: !item.favorite } : item
      );
      this.#notify({ type: 'upsert', itemId: id });
      return;
    }

    try {
      const newFavorite = await clipboardToggleFavorite(id);
      // Update local state without a full reload
      this.items = this.items.map(item =>
        item.id === id ? { ...item, favorite: newFavorite } : item
      );
      this.#notify({ type: 'upsert', itemId: id });
    } catch (error) {
      logService.error(`Failed to toggle favorite status: ${error}`);
    }
  }

  /**
   * Delete an item from history.
   */
  async deleteHistoryItem(id: string): Promise<void> {
    if (!envService.isTauri) {
      this.items = this.items.filter(item => item.id !== id);
      this.#notify({ type: 'delete', itemId: id });
      return;
    }

    try {
      await clipboardDeleteItem(id);
      this.items = this.items.filter(item => item.id !== id);
      this.#notify({ type: 'delete', itemId: id });
    } catch (error) {
      logService.error(`Failed to delete clipboard history item: ${error}`);
    }
  }

  /**
   * Clear all non-favorite items from history.
   */
  async clearHistory(): Promise<void> {
    const removedIds = this.items.filter(item => !item.favorite).map(item => item.id);
    if (!envService.isTauri) {
      this.items = this.items.filter(item => item.favorite);
      removedIds.forEach((id) => this.#notify({ type: 'delete', itemId: id }));
      return;
    }

    try {
      await clipboardClearNonFavorites();
      this.items = this.items.filter(item => item.favorite);
      removedIds.forEach((id) => this.#notify({ type: 'delete', itemId: id }));
    } catch (error) {
      logService.error(`Failed to clear clipboard history: ${error}`);
    }
  }
}

export const clipboardHistoryStore = new ClipboardHistoryStoreClass();
