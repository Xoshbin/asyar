import type { ClipboardHistoryItem } from "../types/ClipboardType";
import { ClipboardItemType } from "../types/ClipboardType";
import { logService } from "../services/logService";
import type { IClipboardApi } from "./interfaces/IClipboardApi";
import { ClipboardHistoryService } from "../services/clipboardHistoryService";

/**
 * API for clipboard operations available to extensions
 */
export class ClipboardApi implements IClipboardApi {
  /**
   * Read current clipboard content
   */
  async read(): Promise<{ type: ClipboardItemType; content: string }> {
    try {
      const clipboardService = ClipboardHistoryService.getInstance();
      return await clipboardService.readCurrentClipboard();
    } catch (error) {
      logService.error(`Failed to read from clipboard: ${error}`);
      return { type: ClipboardItemType.Text, content: "" };
    }
  }

  /**
   * Write content to clipboard
   */
  async write(type: ClipboardItemType, content: string): Promise<boolean> {
    try {
      const clipboardService = ClipboardHistoryService.getInstance();
      await clipboardService.writeToClipboard({
        id: "temp-write-id",
        type,
        content,
        createdAt: Date.now(),
        favorite: false,
      });
      return true;
    } catch (error) {
      logService.error(`Failed to write to clipboard: ${error}`);
      return false;
    }
  }

  /**
   * Get recent clipboard history items
   */
  async getHistory(limit = 20): Promise<ClipboardHistoryItem[]> {
    try {
      const clipboardService = ClipboardHistoryService.getInstance();
      const items = await clipboardService.getRecentItems(limit);

      // Process and normalize items
      return items.map((item) => {
        if (item.type === ClipboardItemType.Image && item.content) {
          return {
            ...item,
            content: clipboardService.normalizeImageData(item.content),
          };
        }
        return item;
      });
    } catch (error) {
      logService.error(`Failed to get clipboard history: ${error}`);
      return [];
    }
  }

  /**
   * Simulate a paste operation for a history item
   */
  async pasteHistoryItem(itemId: string): Promise<boolean> {
    try {
      const clipboardService = ClipboardHistoryService.getInstance();
      const items = await clipboardService.getRecentItems();
      const itemToPaste = items.find((item) => item.id === itemId);

      if (!itemToPaste) {
        logService.error(`Clipboard history item not found: ${itemId}`);
        return false;
      }

      // For image types, verify content validity
      if (itemToPaste.type === ClipboardItemType.Image) {
        if (!clipboardService.isValidImageData(itemToPaste.content || "")) {
          logService.error(`Cannot paste image with invalid data: ${itemId}`);
          return false;
        }
      }

      // Use the service to handle both hiding window and pasting
      await clipboardService.pasteItem(itemToPaste);
      return true;
    } catch (error) {
      logService.error(`Failed to paste clipboard history item: ${error}`);
      return false;
    }
  }

  /**
   * Format a clipboard item for display
   */
  formatClipboardItem(item: ClipboardHistoryItem): string {
    const clipboardService = ClipboardHistoryService.getInstance();
    return clipboardService.formatClipboardItem(item);
  }

  /**
   * Simulates a paste operation using system keyboard shortcut
   */
  async simulatePaste(): Promise<boolean> {
    try {
      const clipboardService = ClipboardHistoryService.getInstance();
      // Use the service method instead of direct invoke
      return await clipboardService.simulatePaste();
    } catch (error) {
      logService.error(`Failed to simulate paste: ${error}`);
      return false;
    }
  }

  /**
   * Toggle favorite status for a clipboard history item
   */
  async toggleFavorite(itemId: string): Promise<boolean> {
    try {
      const clipboardService = ClipboardHistoryService.getInstance();
      return await clipboardService.toggleItemFavorite(itemId);
    } catch (error) {
      logService.error(`Failed to toggle favorite status: ${error}`);
      return false;
    }
  }

  /**
   * Delete a clipboard history item
   */
  async deleteHistoryItem(itemId: string): Promise<boolean> {
    try {
      const clipboardService = ClipboardHistoryService.getInstance();
      return await clipboardService.deleteItem(itemId);
    } catch (error) {
      logService.error(`Failed to delete clipboard history item: ${error}`);
      return false;
    }
  }

  /**
   * Clear all non-favorite clipboard history items
   */
  async clearHistory(): Promise<boolean> {
    try {
      const clipboardService = ClipboardHistoryService.getInstance();
      return await clipboardService.clearNonFavorites();
    } catch (error) {
      logService.error(`Failed to clear clipboard history: ${error}`);
      return false;
    }
  }
}
