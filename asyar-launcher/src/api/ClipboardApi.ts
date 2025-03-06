import clipboard from "tauri-plugin-clipboard-api";
import { invoke } from "@tauri-apps/api/core";
import { ClipboardHistoryService } from "../services/ClipboardHistoryService";
import type { ClipboardHistoryItem } from "../types/clipboardHistoryItem";
import { LogService } from "../services/logService";
import { ClipboardItemType } from "../types/clipboardHistoryItem";
import { isHtml } from "../utils/isHtml";

/**
 * API for clipboard operations available to extensions
 */
export class ClipboardApi {
  /**
   * Read current clipboard content
   */
  static async read(): Promise<{ type: ClipboardItemType; content: string }> {
    try {
      // Try to read image first
      if (await clipboard.hasImage()) {
        try {
          const imageBase64 = await clipboard.readImageBase64();
          if (imageBase64) {
            LogService.debug(
              `Read image from clipboard (base64 length: ${imageBase64.length})`
            );
            return {
              type: ClipboardItemType.Image,
              content: `data:image/png;base64,${imageBase64}`,
            };
          }
        } catch (imgError) {
          LogService.error(`Failed to read image from clipboard: ${imgError}`);
        }
      }

      // Try to read text content (which could be HTML)
      const text = await clipboard.readText();
      if (text) {
        return {
          type: isHtml(text) ? ClipboardItemType.Html : ClipboardItemType.Text,
          content: text,
        };
      }

      // Nothing in clipboard
      return {
        type: ClipboardItemType.Text,
        content: "",
      };
    } catch (error) {
      LogService.error(`Failed to read from clipboard: ${error}`);
      return { type: ClipboardItemType.Text, content: "" };
    }
  }

  /**
   * Write content to clipboard
   */
  static async write(
    type: ClipboardItemType,
    content: string
  ): Promise<boolean> {
    try {
      switch (type) {
        case ClipboardItemType.Text:
          await clipboard.writeText(content);
          break;

        case ClipboardItemType.Html:
          // Create a plain text fallback
          const div = document.createElement("div");
          div.innerHTML = content;
          const plainText = div.textContent || div.innerText || "";

          try {
            if (typeof clipboard.writeHtml === "function") {
              await clipboard.writeHtml(content);
            } else {
              await clipboard.writeText(plainText);
            }
          } catch (error) {
            // Fallback to plain text
            await clipboard.writeText(plainText);
          }
          break;

        case ClipboardItemType.Image:
          if (!content) {
            LogService.error("Cannot write empty image to clipboard");
            return false;
          }

          const base64Data = content.replace(/^data:image\/\w+;base64,/, "");
          await clipboard.writeImageBase64(base64Data);
          break;

        default:
          throw new Error(`Unsupported clipboard content type: ${type}`);
      }
      return true;
    } catch (error) {
      LogService.error(`Failed to write to clipboard: ${error}`);
      return false;
    }
  }

  /**
   * Get recent clipboard history items
   */
  static async getHistory(limit = 20): Promise<ClipboardHistoryItem[]> {
    try {
      const clipboardService = ClipboardHistoryService.getInstance();
      const items = await clipboardService.getRecentItems(limit);

      // Process and normalize items
      return items.map((item) => {
        // For images, ensure content exists and is properly formatted
        if (item.type === ClipboardItemType.Image && item.content) {
          // Normalize content format
          let content = item.content.replace(
            "data:image/png;base64, ",
            "data:image/png;base64,"
          );

          // Ensure proper data URI format
          if (!content.startsWith("data:")) {
            content = `data:image/png;base64,${content}`;
          }

          return { ...item, content };
        }
        return item;
      });
    } catch (error) {
      LogService.error(`Failed to get clipboard history: ${error}`);
      return [];
    }
  }

  /**
   * Simulate a paste operation for a history item
   */
  static async pasteHistoryItem(itemId: string): Promise<boolean> {
    try {
      const clipboardService = ClipboardHistoryService.getInstance();
      const items = await clipboardService.getRecentItems();
      const itemToPaste = items.find((item) => item.id === itemId);

      if (!itemToPaste) {
        LogService.error(`Clipboard history item not found: ${itemId}`);
        return false;
      }

      // For image types, verify content validity
      if (itemToPaste.type === ClipboardItemType.Image) {
        const contentPrefix =
          itemToPaste.content?.substring(0, 30) || "undefined";
        if (contentPrefix.includes("AAAAAAAA")) {
          LogService.error(
            `Cannot paste image with placeholder data: ${itemId}`
          );
          return false;
        }
      }

      await clipboardService.pasteItem(itemToPaste);
      return true;
    } catch (error) {
      LogService.error(`Failed to paste clipboard history item: ${error}`);
      return false;
    }
  }

  /**
   * Format a clipboard item for display
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
      LogService.error(`Failed to simulate paste: ${error}`);
      return false;
    }
  }

  /**
   * Toggle favorite status for a clipboard history item
   */
  static async toggleFavorite(itemId: string): Promise<boolean> {
    try {
      const { toggleFavorite } = await import(
        "../stores/clipboardHistoryStore"
      );
      await toggleFavorite(itemId);
      return true;
    } catch (error) {
      LogService.error(`Failed to toggle favorite status: ${error}`);
      return false;
    }
  }

  /**
   * Delete a clipboard history item
   */
  static async deleteHistoryItem(itemId: string): Promise<boolean> {
    try {
      const { deleteHistoryItem } = await import(
        "../stores/clipboardHistoryStore"
      );
      await deleteHistoryItem(itemId);
      return true;
    } catch (error) {
      LogService.error(`Failed to delete clipboard history item: ${error}`);
      return false;
    }
  }

  /**
   * Clear all non-favorite clipboard history items
   */
  static async clearHistory(): Promise<boolean> {
    try {
      const { clearHistory } = await import("../stores/clipboardHistoryStore");
      await clearHistory();
      return true;
    } catch (error) {
      LogService.error(`Failed to clear clipboard history: ${error}`);
      return false;
    }
  }
}
