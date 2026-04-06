import { logService } from "../../log/logService";
import type { ClipboardHistoryItem } from "asyar-sdk";
import {
  clipboardAddItem,
  clipboardGetAll,
  clipboardToggleFavorite,
  clipboardDeleteItem,
  clipboardClearNonFavorites,
  clipboardFindDuplicate,
  clipboardCleanup,
  type StoredClipboardItem,
} from "../../../lib/ipc/commands";
import { envService } from "../../envService";

// Constants
const MAX_HISTORY_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 3 months
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

export class ClipboardHistoryStoreClass {
  items = $state<ClipboardHistoryItem[]>([]);
  private initialized = false;

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
   * Handles dedup: if content matches an existing item, the old one is removed
   * and the new one takes its place (preserving favorite status).
   */
  async addHistoryItem(item: ClipboardHistoryItem): Promise<void> {
    if (!envService.isTauri) {
      // Non-Tauri fallback: in-memory only
      this.items = [item, ...this.items.filter(i => i.id !== item.id)].slice(0, MAX_ITEMS);
      return;
    }

    try {
      // Check for duplicates
      const duplicate = await clipboardFindDuplicate(
        item.type,
        item.content ?? null,
        item.id,
      );

      if (duplicate) {
        // Preserve favorite status from the existing item
        if (duplicate.favorite) {
          item = { ...item, favorite: true };
        }
        // Remove the old duplicate
        await clipboardDeleteItem(duplicate.id);
      }

      // Insert the new item
      await clipboardAddItem(toStored(item));

      // Enforce limits (age + max count)
      await clipboardCleanup(MAX_HISTORY_AGE_MS, MAX_ITEMS);

      // Refresh in-memory state from the DB (single source of truth)
      const stored = await clipboardGetAll();
      this.items = fromStored(stored);
    } catch (error) {
      logService.error(`Failed to add clipboard history item: ${error}`);
    }
  }

  /**
   * Get all clipboard history items.
   */
  async getHistoryItems(): Promise<ClipboardHistoryItem[]> {
    if (!envService.isTauri) return this.items;

    try {
      const stored = await clipboardGetAll();
      this.items = fromStored(stored);
      return this.items;
    } catch (error) {
      logService.error(`Failed to get clipboard history items: ${error}`);
      return this.items;
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
      return;
    }

    try {
      const newFavorite = await clipboardToggleFavorite(id);
      // Update local state without a full reload
      this.items = this.items.map(item =>
        item.id === id ? { ...item, favorite: newFavorite } : item
      );
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
      return;
    }

    try {
      await clipboardDeleteItem(id);
      this.items = this.items.filter(item => item.id !== id);
    } catch (error) {
      logService.error(`Failed to delete clipboard history item: ${error}`);
    }
  }

  /**
   * Clear all non-favorite items from history.
   */
  async clearHistory(): Promise<void> {
    if (!envService.isTauri) {
      this.items = this.items.filter(item => item.favorite);
      return;
    }

    try {
      await clipboardClearNonFavorites();
      this.items = this.items.filter(item => item.favorite);
    } catch (error) {
      logService.error(`Failed to clear clipboard history: ${error}`);
    }
  }
}

export const clipboardHistoryStore = new ClipboardHistoryStoreClass();
