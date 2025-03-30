import { LazyStore } from "@tauri-apps/plugin-store";
import { writable, type Writable } from "svelte/store";
import { logService } from "../../log/logService";
import type { ClipboardHistoryItem } from "asyar-api";

// Constants
const STORE_PATH = "clipboard_history.json";
const MAX_HISTORY_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 3 months
const MAX_ITEMS = 1000;

// Store singleton
let store: LazyStore | null = null;

// Svelte store for real-time updates
export const clipboardHistory: Writable<ClipboardHistoryItem[]> = writable([]);

/**
 * Initialize the clipboard history store
 */
export async function initClipboardStore(): Promise<void> {
  if (store) return;

  store = new LazyStore(STORE_PATH, { autoSave: 100 });
  await store.init();

  // Load initial data
  clipboardHistory.set(await getHistoryItems());
}

/**
 * Add an item to the clipboard history
 */
export async function addHistoryItem(
  item: ClipboardHistoryItem
): Promise<void> {
  if (!store) await initClipboardStore();

  try {
    let items = await getHistoryItems();

    // Check for duplicates by content or ID
    const isDuplicate = items.some(
      (existing) =>
        item.type === existing.type &&
        ((item.content && item.content === existing.content) ||
          (item.type === "image" && item.id === existing.id))
    );

    if (isDuplicate) return;

    // Add new item and clean up old ones
    items = [item, ...items];

    const cutoffTime = Date.now() - MAX_HISTORY_AGE_MS;
    items = items
      .filter((item) => item.favorite || item.createdAt > cutoffTime)
      .slice(0, MAX_ITEMS);

    await store?.set("items", items);
    clipboardHistory.set(items);
  } catch (error) {
    logService.error(`Failed to add clipboard history item: ${error}`);
  }
}

/**
 * Get all clipboard history items
 */
export async function getHistoryItems(): Promise<ClipboardHistoryItem[]> {
  if (!store) await initClipboardStore();

  try {
    return (await store?.get<ClipboardHistoryItem[]>("items")) || [];
  } catch (error) {
    logService.error(`Failed to get clipboard history items: ${error}`);
    return [];
  }
}

/**
 * Toggle favorite status of an item
 */
export async function toggleFavorite(id: string): Promise<void> {
  if (!store) await initClipboardStore();

  try {
    const items = await getHistoryItems();
    const updatedItems = items.map((item) =>
      item.id === id ? { ...item, favorite: !item.favorite } : item
    );

    await store?.set("items", updatedItems);
    clipboardHistory.set(updatedItems);
  } catch (error) {
    logService.error(`Failed to toggle favorite status: ${error}`);
  }
}

/**
 * Delete an item from history
 */
export async function deleteHistoryItem(id: string): Promise<void> {
  if (!store) await initClipboardStore();

  try {
    const items = await getHistoryItems();
    const updatedItems = items.filter((item) => item.id !== id);

    await store?.set("items", updatedItems);
    clipboardHistory.set(updatedItems);
  } catch (error) {
    logService.error(`Failed to delete clipboard history item: ${error}`);
  }
}

/**
 * Clear all non-favorite items from history
 */
export async function clearHistory(): Promise<void> {
  if (!store) await initClipboardStore();

  try {
    const items = await getHistoryItems();
    const favoriteItems = items.filter((item) => item.favorite);

    await store?.set("items", favoriteItems);
    clipboardHistory.set(favoriteItems);
  } catch (error) {
    logService.error(`Failed to clear clipboard history: ${error}`);
  }
}
