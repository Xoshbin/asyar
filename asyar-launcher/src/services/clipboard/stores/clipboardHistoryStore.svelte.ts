import { logService } from "../../log/logService";
import type { ClipboardHistoryItem } from "asyar-sdk/contracts";
import {
  clipboardGetAll,
  clipboardGetRecent,
  clipboardToggleFavorite,
  clipboardDeleteItem,
  clipboardClearNonFavorites,
  clipboardRecordCapture,
  type StoredClipboardItem,
} from "../../../lib/ipc/commands";

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

    try {
      const stored = await clipboardGetAll();
      this.items = fromStored(stored);
    } catch (error) {
      logService.error(`Failed to init clipboard history store: ${error}`);
    }
  }

  /**
   * Add an item to the clipboard history.
   * Delegates all dedup / insert / cleanup logic — and source-app iconUrl
   * enrichment — to the Rust `clipboard_record_capture` command. The
   * returned list is the new source of truth.
   */
  async addHistoryItem(item: ClipboardHistoryItem): Promise<void> {
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
   * Get all favorites plus the newest `limit` non-favorites, as returned by Rust.
   * The ordering (favorites-first, then newest non-favorites) is determined
   * server-side; this method returns the list unchanged.
   */
  async getRecentItems(limit: number): Promise<ClipboardHistoryItem[]> {
    try {
      const stored = await clipboardGetRecent(limit);
      this.items = fromStored(stored);
      return $state.snapshot(this.items) as ClipboardHistoryItem[];
    } catch (error) {
      logService.error(`Failed to get recent clipboard items: ${error}`);
      return [];
    }
  }

  /**
   * Toggle favorite status of an item.
   */
  async toggleFavorite(id: string): Promise<void> {
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
