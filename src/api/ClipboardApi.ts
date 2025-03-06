import clipboard from "tauri-plugin-clipboard-api";
import { invoke } from "@tauri-apps/api/core";
import { ClipboardHistoryService } from "../services/ClipboardHistoryService";
import type { ClipboardHistoryItem } from "../types/clipboardHistoryItem";
import { LogService } from "../services/logService";
import { ClipboardItemType } from "../types/clipboardHistoryItem";
import { isHtml } from "../utils/isHtml";

/**
 * ClipboardApi provides a safe interface for extensions to interact with clipboard functionality.
 */
export class ClipboardApi {
  /**
   * Read content from the clipboard - tries to determine the content type
   * and returns the appropriate content
   */
  static async read(): Promise<{ type: ClipboardItemType; content: string }> {
    try {
      // First check if there's an image
      if (await clipboard.hasImage()) {
        try {
          const imageBase64 = await clipboard.readImageBase64();
          if (imageBase64) {
            LogService.debug(
              `Read image from clipboard with base64 length: ${imageBase64.length}`
            );
            const content = `data:image/png;base64,${imageBase64}`;
            return {
              type: ClipboardItemType.Image,
              content: content,
            };
          }
        } catch (imgError) {
          LogService.error(`Failed to read image from clipboard: ${imgError}`);
        }
      }

      // Then try to read text content (which could be HTML)
      const text = await clipboard.readText();
      if (text) {
        // Check if content is HTML
        if (isHtml(text)) {
          return {
            type: ClipboardItemType.Html,
            content: text,
          };
        }
        // Regular text
        return {
          type: ClipboardItemType.Text,
          content: text,
        };
      }

      // If we got here, there's nothing in the clipboard
      return {
        type: ClipboardItemType.Text,
        content: "",
      };
    } catch (error) {
      LogService.error(`Failed to read from clipboard: ${error}`);
      return {
        type: ClipboardItemType.Text,
        content: "",
      };
    }
  }

  /**
   * Write content to the clipboard based on its type
   * @param type The type of content to write
   * @param content The content to write
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

          // Try to use HTML writing if available
          try {
            if (typeof clipboard.writeHtml === "function") {
              await clipboard.writeHtml(content);
            } else {
              await clipboard.writeText(plainText);
            }
          } catch (e) {
            // If HTML writing fails, fall back to plain text
            await clipboard.writeText(plainText);
          }
          break;

        case ClipboardItemType.Image:
          // Extract base64 data
          if (!content) {
            LogService.error(`Cannot write empty image to clipboard`);
            return false;
          }

          LogService.debug(
            `Writing image to clipboard, content starts with: ${content.substring(
              0,
              30
            )}...`
          );

          const base64Data = content.replace(/^data:image\/\w+;base64,/, "");
          LogService.debug(
            `Extracted base64 image data with length: ${base64Data.length}`
          );

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

  // For backward compatibility
  static async readText(): Promise<string> {
    try {
      const result = await this.read();
      if (
        result.type === ClipboardItemType.Text ||
        result.type === ClipboardItemType.Html
      ) {
        return result.content;
      }
      return "";
    } catch (error) {
      LogService.error(`Failed to read text from clipboard: ${error}`);
      return "";
    }
  }

  // For backward compatibility
  static async writeText(text: string): Promise<boolean> {
    return this.write(ClipboardItemType.Text, text);
  }

  /**
   * Get recent clipboard history items
   * @param limit Maximum number of items to retrieve (default: 20)
   */
  static async getHistory(limit: number = 20): Promise<ClipboardHistoryItem[]> {
    try {
      LogService.debug(`Getting clipboard history (limit: ${limit})...`);
      const clipboardService = ClipboardHistoryService.getInstance();

      // Get history items
      const items = await clipboardService.getRecentItems(limit);

      // Process and return items
      return items.map((item) => {
        // For images, ensure content exists and is properly formatted
        if (item.type === ClipboardItemType.Image && item.content) {
          // Clean up the content - some images have an extra space in prefix
          let content = item.content.replace(
            "data:image/png;base64, ",
            "data:image/png;base64,"
          );

          // Ensure proper data URI format
          if (!content.startsWith("data:")) {
            content = `data:image/png;base64,${content}`;
            LogService.debug(`Added data prefix to image ${item.id}`);
          }

          return { ...item, content };
        }

        // Return other item types unchanged
        return item;
      });
    } catch (error) {
      LogService.error(`Failed to get clipboard history: ${error}`);
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
        LogService.error(`Clipboard history item not found: ${itemId}`);
        return false;
      }

      LogService.debug(
        `Attempting to paste clipboard item: ${itemId} (type: ${itemToPaste.type})`
      );

      // For image types, log more details to help debug
      if (itemToPaste.type === ClipboardItemType.Image) {
        const contentPrefix =
          itemToPaste.content?.substring(0, 30) || "undefined";
        LogService.debug(`Image content prefix: ${contentPrefix}...`);

        // Check if this appears to be broken data
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
      LogService.error(`Failed to simulate paste: ${error}`);
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
      LogService.error(`Failed to toggle favorite status: ${error}`);
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
      LogService.error(`Failed to delete clipboard history item: ${error}`);
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
      LogService.error(`Failed to clear clipboard history: ${error}`);
      return false;
    }
  }
}
