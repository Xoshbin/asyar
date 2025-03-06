import { LazyStore } from "@tauri-apps/plugin-store";
import type { ClipboardHistoryItem } from "../types/clipboardHistoryItem";
import { writable, type Writable } from "svelte/store";
import { LogService } from "../services/logService";

// Define store path
const STORE_PATH = "clipboard_history.json";
const MAX_HISTORY_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 3 months in milliseconds
const MAX_ITEMS = 1000; // Maximum number of items to store

// Store instance
let store: LazyStore | null = null;

// Svelte store for real-time updates
export const clipboardHistory: Writable<ClipboardHistoryItem[]> = writable([]);

/**
 * Initialize the clipboard history store
 */
export async function initClipboardStore(): Promise<void> {
  if (!store) {
    store = new LazyStore(STORE_PATH, {
      autoSave: 100, // Auto save with 100ms debounce
    });
    await store.init();

    // Load initial data
    const items = await getHistoryItems();
    clipboardHistory.set(items);
  }
}

/**
 * Add an item to the clipboard history
 */
export async function addHistoryItem(
  item: ClipboardHistoryItem
): Promise<void> {
  if (!store) {
    await initClipboardStore();
  }

  try {
    // Get current items
    let items = await getHistoryItems();

    // Check for duplicates (by content for text/html, by id for images)
    const isDuplicate = items.some(
      (existing) =>
        item.type === existing.type &&
        ((item.content && item.content === existing.content) ||
          (item.type === "image" && item.id === existing.id))
    );

    if (!isDuplicate) {
      // Add new item at the beginning
      items = [item, ...items];

      // Clean up old items
      const cutoffTime = Date.now() - MAX_HISTORY_AGE_MS;
      items = items
        .filter((item) => item.createdAt > cutoffTime || item.favorite)
        .slice(0, MAX_ITEMS);

      // Save to store
      await store?.set("items", items);

      // Update Svelte store
      clipboardHistory.set(items);
    }
  } catch (error) {
    LogService.error(`Failed to add clipboard history item: ${error}`);
  }
}

/**
 * Get all clipboard history items
 */
export async function getHistoryItems(): Promise<ClipboardHistoryItem[]> {
  if (!store) {
    await initClipboardStore();
  }

  try {
    const items = (await store?.get<ClipboardHistoryItem[]>("items")) || [];
    return items;
  } catch (error) {
    LogService.error(`Failed to get clipboard history items: ${error}`);
    return [];
  }
}

/**
 * Toggle favorite status of an item
 */
export async function toggleFavorite(id: string): Promise<void> {
  if (!store) {
    await initClipboardStore();
  }

  try {
    const items = await getHistoryItems();
    const updatedItems = items.map((item) =>
      item.id === id ? { ...item, favorite: !item.favorite } : item
    );

    await store?.set("items", updatedItems);
    clipboardHistory.set(updatedItems);
  } catch (error) {
    LogService.error(`Failed to toggle favorite status: ${error}`);
  }
}

/**
 * Delete an item from history
 */
export async function deleteHistoryItem(id: string): Promise<void> {
  if (!store) {
    await initClipboardStore();
  }

  try {
    const items = await getHistoryItems();
    const updatedItems = items.filter((item) => item.id !== id);

    await store?.set("items", updatedItems);
    clipboardHistory.set(updatedItems);
  } catch (error) {
    LogService.error(`Failed to delete clipboard history item: ${error}`);
  }
}

/**
 * Clear all non-favorite items from history
 */
export async function clearHistory(): Promise<void> {
  if (!store) {
    await initClipboardStore();
  }

  try {
    const items = await getHistoryItems();
    const favoriteItems = items.filter((item) => item.favorite);

    await store?.set("items", favoriteItems);
    clipboardHistory.set(favoriteItems);
  } catch (error) {
    LogService.error(`Failed to clear clipboard history: ${error}`);
  }
}
