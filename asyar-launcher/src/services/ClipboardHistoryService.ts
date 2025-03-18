import {
  readText,
  readImage,
  writeText,
  writeHtml,
  writeImage,
} from "@tauri-apps/plugin-clipboard-manager";
import { invoke } from "@tauri-apps/api/core";
import { v4 as uuidv4 } from "uuid";
import {
  addHistoryItem,
  getHistoryItems,
  initClipboardStore,
  toggleFavorite as storeToggleFavorite,
  deleteHistoryItem as storeDeleteHistoryItem,
  clearHistory as storeClearHistory,
} from "../stores/clipboardHistoryStore";
import { logService } from "./logService";
import { isHtml } from "../utils/isHtml";
import {
  ClipboardItemType,
  type ClipboardHistoryItem,
  type IClipboardHistoryService,
} from "asyar-api";

/**
 * Service for managing clipboard history
 */
export class ClipboardHistoryService implements IClipboardHistoryService {
  private static instance: ClipboardHistoryService;
  private pollingInterval: number | null = null;
  private lastTextContent = "";
  private readonly POLLING_MS = 1000;

  private constructor() {}

  /**
   * Get the singleton instance
   */
  public static getInstance(): IClipboardHistoryService {
    if (!ClipboardHistoryService.instance) {
      ClipboardHistoryService.instance = new ClipboardHistoryService();
    }
    return ClipboardHistoryService.instance;
  }

  /**
   * Initialize the clipboard history service
   */
  public async initialize(): Promise<void> {
    logService.debug("Initializing ClipboardHistoryService");
    await initClipboardStore();
    this.startMonitoring();
    logService.debug("ClipboardHistoryService initialized");
  }

  /**
   * Start monitoring clipboard for changes
   */
  private startMonitoring(): void {
    if (this.pollingInterval) return;

    // Initial clipboard capture
    this.captureCurrentClipboard();

    // Set up polling
    this.pollingInterval = window.setInterval(() => {
      this.captureCurrentClipboard();
    }, this.POLLING_MS);

    logService.debug("Started clipboard monitoring");
  }

  /**
   * Stop monitoring clipboard
   */
  public stopMonitoring(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      logService.debug("Stopped clipboard monitoring");
    }
  }

  /**
   * Capture current clipboard content
   */
  private async captureCurrentClipboard(): Promise<void> {
    try {
      await this.captureTextContent();
      await this.captureImageContent();
    } catch (error) {
      logService.error(`Error capturing clipboard content: ${error}`);
    }
  }

  /**
   * Capture text/HTML content from clipboard
   */
  private async captureTextContent(): Promise<void> {
    try {
      const text = await readText();
      this.lastTextContent = text;

      // Skip if empty
      if (!text) return;

      const contentType = isHtml(text)
        ? ClipboardItemType.Html
        : ClipboardItemType.Text;

      const item: ClipboardHistoryItem = {
        id: uuidv4(),
        type: contentType,
        content: text,
        preview: this.createPreview(text, contentType),
        createdAt: Date.now(),
        favorite: false,
      };

      await addHistoryItem(item);
    } catch (error) {
      logService.error(`Error capturing text content: ${error}`);
    }
  }

  /**
   * Capture image content from clipboard
   */
  private async captureImageContent(): Promise<void> {
    try {
      const clipboardImage = await readImage();
      const blob = new Blob([await clipboardImage.rgba()], { type: "image" });
      const url = URL.createObjectURL(blob);
      const imageId = uuidv4();

      if (!clipboardImage) return;

      const item: ClipboardHistoryItem = {
        id: imageId,
        type: ClipboardItemType.Image,
        content: url,
        preview: `Image: ${new Date().toLocaleTimeString()}`,
        createdAt: Date.now(),
        favorite: false,
      };

      await addHistoryItem(item);
    } catch (error) {
      // No image in clipboard or error reading it
    }
  }

  /**
   * Create a preview of clipboard content
   */
  private createPreview(content: string, type: ClipboardItemType): string {
    if (!content) return "No preview available";

    if (type === ClipboardItemType.Html) {
      const div = document.createElement("div");
      div.innerHTML = content;
      const text = div.textContent || div.innerText || "";
      return this.truncateText(text);
    } else if (type === ClipboardItemType.Text) {
      return this.truncateText(content);
    }

    return "No preview available";
  }

  /**
   * Truncate text for preview
   */
  private truncateText(text: string, maxLength = 100): string {
    return text.length > maxLength
      ? text.substring(0, maxLength) + "..."
      : text;
  }

  /**
   * Format clipboard item for display
   */
  public formatClipboardItem(item: ClipboardHistoryItem): string {
    if (item.type === ClipboardItemType.Image) {
      return `Image captured on ${new Date(item.createdAt).toLocaleString()}`;
    }

    if (!item.content) return "";
    return this.truncateText(item.content);
  }

  /**
   * Write item back to clipboard and simulate paste
   */
  public async pasteItem(item: ClipboardHistoryItem): Promise<void> {
    try {
      // Hide the app window before writing to clipboard
      await this.hideWindow();

      // Write content to clipboard
      await this.writeToClipboard(item);

      // Simulate paste operation
      await this.simulatePaste();
    } catch (error) {
      logService.error(`Failed to paste clipboard item: ${error}`);
      throw error;
    }
  }

  /**
   * Hide the application window
   */
  public async hideWindow(): Promise<void> {
    try {
      await invoke("hide");
    } catch (error) {
      logService.error(`Failed to hide window: ${error}`);
    }
  }

  /**
   * Simulate paste operation using system keyboard shortcut
   */
  public async simulatePaste(): Promise<boolean> {
    try {
      await invoke("simulate_paste");
      return true;
    } catch (error) {
      logService.error(`Failed to simulate paste: ${error}`);
      return false;
    }
  }

  /**
   * Write item to system clipboard based on type
   */
  public async writeToClipboard(item: ClipboardHistoryItem): Promise<void> {
    if (!item.content) {
      throw new Error("Cannot paste item with empty content");
    }

    switch (item.type) {
      case ClipboardItemType.Text:
        await writeText(item.content);
        break;

      case ClipboardItemType.Html:
        await this.writeHtmlContent(item.content);
        break;

      case ClipboardItemType.Image:
        await this.writeImageContent(item.content);
        break;

      default:
        throw new Error(`Unsupported clipboard item type: ${item.type}`);
    }
  }

  /**
   * Write HTML content to clipboard with fallback
   */
  private async writeHtmlContent(html: string): Promise<void> {
    // Create plain text fallback
    const div = document.createElement("div");
    div.innerHTML = html;
    const plainText = div.textContent || div.innerText || "";

    try {
      if (typeof writeHtml === "function") {
        await writeHtml(html);
      } else {
        await writeText(plainText);
      }
    } catch (error) {
      // Fallback to plain text on error
      await writeText(plainText);
    }
  }

  /**
   * Write image content to clipboard
   */
  private async writeImageContent(imageData: string): Promise<void> {
    logService.debug(`Writing image to clipboard`);

    // Extract the base64 part
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");

    if (base64Data.length === 0) {
      throw new Error("Invalid image data");
    }

    await writeImage(base64Data);
  }

  /**
   * Get recent clipboard items
   */
  public async getRecentItems(limit = 30): Promise<ClipboardHistoryItem[]> {
    try {
      const items = await getHistoryItems();

      return items
        .filter((item) => item && item.id && item.type)
        .slice(0, limit);
    } catch (error) {
      logService.error(`Error retrieving clipboard items: ${error}`);
      return [];
    }
  }

  /**
   * Toggle favorite status of a history item
   */
  public async toggleItemFavorite(itemId: string): Promise<boolean> {
    try {
      await storeToggleFavorite(itemId);
      return true;
    } catch (error) {
      logService.error(`Error toggling item favorite status: ${error}`);
      return false;
    }
  }

  /**
   * Delete an item from history
   */
  public async deleteItem(itemId: string): Promise<boolean> {
    try {
      await storeDeleteHistoryItem(itemId);
      return true;
    } catch (error) {
      logService.error(`Error deleting history item: ${error}`);
      return false;
    }
  }

  /**
   * Clear non-favorite items from history
   */
  public async clearNonFavorites(): Promise<boolean> {
    try {
      await storeClearHistory();
      return true;
    } catch (error) {
      logService.error(`Error clearing non-favorite items: ${error}`);
      return false;
    }
  }

  /**
   * Normalize image data to ensure consistent format
   */
  public normalizeImageData(content: string): string {
    // Clean up the data URI if needed (some images have "data:image/png;base64, " with an extra space)
    let normalizedContent = content.replace(
      "data:image/png;base64, ",
      "data:image/png;base64,"
    );

    // Ensure proper data URI format
    if (!normalizedContent.startsWith("data:")) {
      normalizedContent = `data:image/png;base64,${normalizedContent}`;
    }

    return normalizedContent;
  }

  /**
   * Check if image data is valid
   */
  public isValidImageData(content: string): boolean {
    if (!content) return false;

    // Basic checks for valid content
    if (content.includes("AAAAAAAA")) {
      return false; // Placeholder data
    }

    return true;
  }

  /**
   * Read the current content from the clipboard
   * Added for ClipboardApi to use instead of direct plugin access
   */
  public async readCurrentClipboard(): Promise<{
    type: ClipboardItemType;
    content: string;
  }> {
    try {
      // Try to read image first
      try {
        const clipboardImage = await readImage();
        if (clipboardImage) {
          const arrayBuffer = await clipboardImage.rgba();
          if (arrayBuffer.byteLength > 0) {
            logService.debug(
              `Read image from clipboard (size: ${arrayBuffer.byteLength})`
            );

            // Convert to base64
            const bytes = new Uint8Array(arrayBuffer);
            let binary = "";
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64 = window.btoa(binary);

            return {
              type: ClipboardItemType.Image,
              content: `data:image/png;base64,${base64}`,
            };
          }
        }
      } catch (imgError) {
        logService.error(`Failed to read image from clipboard: ${imgError}`);
      }

      // Try to read text content
      const text = await readText();
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
      logService.error(`Failed to read from clipboard: ${error}`);
      return { type: ClipboardItemType.Text, content: "" };
    }
  }
}
