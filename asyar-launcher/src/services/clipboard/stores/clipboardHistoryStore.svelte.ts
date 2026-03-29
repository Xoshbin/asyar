import { LazyStore } from "@tauri-apps/plugin-store";
import { logService } from "../../log/logService";
import type { ClipboardHistoryItem } from "asyar-sdk";

// Constants
const STORE_PATH = "clipboard_history.json";
const MAX_HISTORY_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 3 months
const MAX_ITEMS = 1000;

class ClipboardHistoryStoreClass {
  items = $state<ClipboardHistoryItem[]>([]);
  private store: LazyStore | null = null;

  /**
   * Initialize the clipboard history store
   */
  async init(): Promise<void> {
    if (this.store) return;

    this.store = new LazyStore(STORE_PATH, { autoSave: 100, defaults: {} });
    await this.store.init();

    // Load initial data
    this.items = await this.getHistoryItems();
  }

  /**
   * Add an item to the clipboard history
   */
  async addHistoryItem(item: ClipboardHistoryItem): Promise<void> {
    if (!this.store) await this.init();

    try {
      let currentItems = await this.getHistoryItems();

      // Check for duplicates by content or ID
      const isDuplicate = currentItems.some(
        (existing) =>
          item.type === existing.type &&
          ((item.content && item.content === existing.content) ||
            (item.type === "image" && item.id === existing.id))
      );

      if (isDuplicate) return;

      // Add new item and clean up old ones
      currentItems = [item, ...currentItems];

      const cutoffTime = Date.now() - MAX_HISTORY_AGE_MS;
      currentItems = currentItems
        .filter((item) => item.favorite || item.createdAt > cutoffTime)
        .slice(0, MAX_ITEMS);

      await this.store?.set("items", currentItems);
      this.items = currentItems;
    } catch (error) {
      logService.error(`Failed to add clipboard history item: ${error}`);
    }
  }

  /**
   * Get all clipboard history items
   */
  async getHistoryItems(): Promise<ClipboardHistoryItem[]> {
    if (!this.store) await this.init();

    try {
      return (await this.store?.get<ClipboardHistoryItem[]>("items")) || [];
    } catch (error) {
      logService.error(`Failed to get clipboard history items: ${error}`);
      return [];
    }
  }

  /**
   * Toggle favorite status of an item
   */
  async toggleFavorite(id: string): Promise<void> {
    if (!this.store) await this.init();

    try {
      const currentItems = await this.getHistoryItems();
      const updatedItems = currentItems.map((item) =>
        item.id === id ? { ...item, favorite: !item.favorite } : item
      );

      await this.store?.set("items", updatedItems);
      this.items = updatedItems;
    } catch (error) {
      logService.error(`Failed to toggle favorite status: ${error}`);
    }
  }

  /**
   * Delete an item from history
   */
  async deleteHistoryItem(id: string): Promise<void> {
    if (!this.store) await this.init();

    try {
      const currentItems = await this.getHistoryItems();
      const updatedItems = currentItems.filter((item) => item.id !== id);

      await this.store?.set("items", updatedItems);
      this.items = updatedItems;
    } catch (error) {
      logService.error(`Failed to delete clipboard history item: ${error}`);
    }
  }

  /**
   * Clear all non-favorite items from history
   */
  async clearHistory(): Promise<void> {
    if (!this.store) await this.init();

    try {
      const currentItems = await this.getHistoryItems();
      const favoriteItems = currentItems.filter((item) => item.favorite);

      await this.store?.set("items", favoriteItems);
      this.items = favoriteItems;
    } catch (error) {
      logService.error(`Failed to clear clipboard history: ${error}`);
    }
  }
}

export const clipboardHistoryStore = new ClipboardHistoryStoreClass();
