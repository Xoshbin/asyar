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
} from "../stores/clipboardHistoryStore";
import {
  ClipboardItemType,
  type ClipboardHistoryItem,
} from "../types/clipboardHistoryItem";
import { LogService } from "./logService";
import { isHtml } from "../utils/isHtml";

/**
 * Service for managing clipboard history
 */
export class ClipboardHistoryService {
  private static instance: ClipboardHistoryService;
  private pollingInterval: number | null = null;
  private lastTextContent = "";
  private readonly POLLING_MS = 1000;

  private constructor() {}

  /**
   * Get the singleton instance
   */
  public static getInstance(): ClipboardHistoryService {
    if (!ClipboardHistoryService.instance) {
      ClipboardHistoryService.instance = new ClipboardHistoryService();
    }
    return ClipboardHistoryService.instance;
  }

  /**
   * Initialize the clipboard history service
   */
  public async initialize(): Promise<void> {
    LogService.debug("Initializing ClipboardHistoryService");
    await initClipboardStore();
    this.startMonitoring();
    LogService.debug("ClipboardHistoryService initialized");
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

    LogService.debug("Started clipboard monitoring");
  }

  /**
   * Stop monitoring clipboard
   */
  public stopMonitoring(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      LogService.debug("Stopped clipboard monitoring");
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
      LogService.error(`Error capturing clipboard content: ${error}`);
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
      LogService.error(`Error capturing text content: ${error}`);
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
    // Hide app window before paste
    invoke("hide");

    try {
      await this.writeToClipboard(item);
      await invoke("simulate_paste");
    } catch (error) {
      LogService.error(`Failed to paste clipboard item: ${error}`);
      throw error;
    }
  }

  /**
   * Write item to system clipboard based on type
   */
  private async writeToClipboard(item: ClipboardHistoryItem): Promise<void> {
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
    LogService.debug(`Writing image to clipboard`);

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
      LogService.error(`Error retrieving clipboard items: ${error}`);
      return [];
    }
  }
}
