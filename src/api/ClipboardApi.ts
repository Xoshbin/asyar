import {
  readText,
  readImage,
  writeText,
  writeHtml,
  writeImage,
} from "@tauri-apps/plugin-clipboard-manager";
import { invoke } from "@tauri-apps/api/core";
import { ClipboardHistoryService } from "../services/ClipboardHistoryService";
import type { ClipboardHistoryItem } from "../types/clipboardHistoryItem";

/**
 * ClipboardApi provides a safe interface for extensions to interact with clipboard functionality.
 */
export class ClipboardApi {
  /**
   * Read text from the clipboard
   */
  static async readText(): Promise<string> {
    try {
      return await readText();
    } catch (error) {
      console.error("Failed to read text from clipboard:", error);
      return "";
    }
  }

  /**
   * Write text to the clipboard
   * @param text The text to write
   */
  static async writeText(text: string): Promise<boolean> {
    try {
      await writeText(text);
      return true;
    } catch (error) {
      console.error("Failed to write text to clipboard:", error);
      return false;
    }
  }

  /**
   * Write HTML to the clipboard
   * @param html The HTML content to write
   * @param plainText Optional fallback plain text
   */
  static async writeHtml(html: string, plainText?: string): Promise<boolean> {
    try {
      await writeHtml(html, plainText);
      return true;
    } catch (error) {
      console.error("Failed to write HTML to clipboard:", error);
      return false;
    }
  }

  /**
   * Get recent clipboard history items
   * @param limit Maximum number of items to retrieve (default: 20)
   */
  static async getHistory(limit: number = 20): Promise<ClipboardHistoryItem[]> {
    try {
      const clipboardService = ClipboardHistoryService.getInstance();
      const items = await clipboardService.getRecentItems(limit);

      // Sanitize content for security (extensions shouldn't get full content)
      return items.map((item) => ({
        ...item,
        // Remove content property from images for security and size reasons
        content: item.type === "image" ? undefined : item.content,
      }));
    } catch (error) {
      console.error("Failed to get clipboard history:", error);
      return [];
    }
  }

  /**
   * Simulate a paste operation for the given clipboard history item
   * @param itemId ID of the clipboard history item to paste
   */
  static async pasteHistoryItem(itemId: string): Promise<boolean> {
    try {
      const clipboardService = ClipboardHistoryService.getInstance();
      const items = await clipboardService.getRecentItems();
      const itemToPaste = items.find((item) => item.id === itemId);

      if (!itemToPaste) {
        console.error("Clipboard history item not found:", itemId);
        return false;
      }

      await clipboardService.pasteItem(itemToPaste);
      return true;
    } catch (error) {
      console.error("Failed to paste clipboard history item:", error);
      return false;
    }
  }

  /**
   * Format a clipboard item for display
   * @param item The clipboard history item
   */
  static formatClipboardItem(item: ClipboardHistoryItem): string {
    const clipboardService = ClipboardHistoryService.getInstance();
    return clipboardService.formatClipboardItem(item);
  }

  /**
   * Simulates a paste operation using system keyboard shortcut
   */
  static async simulatePaste(): Promise<boolean> {
    try {
      await invoke("simulate_paste");
      return true;
    } catch (error) {
      console.error("Failed to simulate paste:", error);
      return false;
    }
  }

  /**
   * Toggle favorite status for a clipboard history item
   * @param itemId ID of the clipboard history item
   */
  static async toggleFavorite(itemId: string): Promise<boolean> {
    try {
      // Get store functionality directly to avoid circular dependencies
      const { toggleFavorite } = await import(
        "../stores/clipboardHistoryStore"
      );
      await toggleFavorite(itemId);
      return true;
    } catch (error) {
      console.error("Failed to toggle favorite status:", error);
      return false;
    }
  }

  /**
   * Delete a clipboard history item
   * @param itemId ID of the clipboard history item to delete
   */
  static async deleteHistoryItem(itemId: string): Promise<boolean> {
    try {
      // Get store functionality directly to avoid circular dependencies
      const { deleteHistoryItem } = await import(
        "../stores/clipboardHistoryStore"
      );
      await deleteHistoryItem(itemId);
      return true;
    } catch (error) {
      console.error("Failed to delete clipboard history item:", error);
      return false;
    }
  }

  /**
   * Clear all non-favorite clipboard history items
   */
  static async clearHistory(): Promise<boolean> {
    try {
      // Get store functionality directly to avoid circular dependencies
      const { clearHistory } = await import("../stores/clipboardHistoryStore");
      await clearHistory();
      return true;
    } catch (error) {
      console.error("Failed to clear clipboard history:", error);
      return false;
    }
  }
}
