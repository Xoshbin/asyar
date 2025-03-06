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
import { isHtml } from "../utils/isHtml"; // Adjust the path as needed

export class ClipboardHistoryService {
  private static instance: ClipboardHistoryService;
  private pollingInterval: number | null = null;
  private lastTextContent: string = "";
  private readonly POLLING_MS = 1000; // Check clipboard every second

  private constructor() {
    // Private constructor to prevent direct construction calls with 'new'
  }

  /**
   * Get the singleton instance of ClipboardHistoryService
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
    LogService.debug(`Initializing ClipboardHistoryService...`);

    // Initialize the store first
    await initClipboardStore();

    // Start monitoring clipboard
    this.startMonitoring();

    LogService.debug(`ClipboardHistoryService initialized`);
  }

  /**
   * Start monitoring clipboard for changes
   */
  private startMonitoring(): void {
    if (this.pollingInterval) {
      return; // Already monitoring
    }

    LogService.debug(`Starting clipboard monitoring`);

    // Initial clipboard content capture
    this.captureCurrentClipboard();

    // Set up polling
    this.pollingInterval = window.setInterval(() => {
      this.captureCurrentClipboard();
    }, this.POLLING_MS);
  }

  /**
   * Stop monitoring clipboard
   */
  public stopMonitoring(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      LogService.debug(`Stopped clipboard monitoring`);
    }
  }

  /**
   * Capture current clipboard content
   */
  private async captureCurrentClipboard(): Promise<void> {
    try {
      // First try to read text (which includes HTML)
      const text = await readText();

      this.lastTextContent = text;

      // Check if content is HTML
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
      LogService.debug(`Added ${item.type} content to clipboard history`);

      // Then try to read image
      try {
        try {
          const clipboardImage = await readImage();
          const blob = new Blob([await clipboardImage.rgba()], {
            type: "image",
          });
          const url = URL.createObjectURL(blob);
          const imageId = uuidv4();

          if (clipboardImage) {
            // Log the first 50 characters of the image content to help debug
            LogService.debug(`Captured image, content starts with: ${url}...`);

            const item: ClipboardHistoryItem = {
              id: imageId,
              type: ClipboardItemType.Image,
              content: url,
              preview: `Image: ${new Date().toLocaleTimeString()}`,
              createdAt: Date.now(),
              favorite: false,
            };

            await addHistoryItem(item);
            LogService.debug(
              `Added image content to clipboard history with ID: ${imageId}`
            );
          } else {
            LogService.debug(
              `Skipping image with insufficient data length: ${
                clipboardImage || 0
              }`
            );
          }
        } catch (imgError) {
          LogService.error(`Error processing image data: ${imgError}`);
        }
      } catch (imageError) {
        // No image in clipboard or not supported, ignore
        LogService.error(`Error reading image from clipboard: ${imageError}`);
      }
    } catch (error) {
      LogService.error(`Error capturing clipboard content: ${error}`);
    }
  }

  /**
   * Create a preview of clipboard content
   */
  private createPreview(content: string, type: ClipboardItemType): string {
    if (type === ClipboardItemType.Html) {
      // Extract text from HTML for preview
      const div = document.createElement("div");
      div.innerHTML = content;
      const text = div.textContent || div.innerText || "";
      return text.substring(0, 100) + (text.length > 100 ? "..." : "");
    } else if (type === ClipboardItemType.Text) {
      // Truncate text for preview
      return content.substring(0, 100) + (content.length > 100 ? "..." : "");
    }

    return "No preview available";
  }

  /**
   * Format clipboard item for display
   */
  public formatClipboardItem(item: ClipboardHistoryItem): string {
    if (item.type === ClipboardItemType.Image) {
      return "Image captured on " + new Date(item.createdAt).toLocaleString();
    } else {
      return (
        item.content?.substring(0, 100) +
          (item.content && item.content.length > 100 ? "..." : "") || ""
      );
    }
  }

  /**
   * Write item back to clipboard and simulate paste
   */
  public async pasteItem(item: ClipboardHistoryItem): Promise<void> {
    invoke("hide"); // Hide the window before pasting
    try {
      // First write content to clipboard based on type
      switch (item.type) {
        case ClipboardItemType.Text:
          if (item.content) {
            await writeText(item.content);
          }
          break;

        case ClipboardItemType.Html:
          if (item.content) {
            // Create a plain text version for fallback
            const div = document.createElement("div");
            div.innerHTML = item.content;
            const plainText = div.textContent || div.innerText || "";

            // Try to use HTML writing if available, otherwise use plain text
            try {
              // Check if we have HTML writing capability
              if (typeof writeHtml === "function") {
                await writeHtml(item.content);
              } else {
                // Fallback to plain text
                await writeText(plainText);
              }
            } catch (e) {
              // If HTML writing fails, fall back to plain text
              await writeText(plainText);
            }
          }
          break;

        case ClipboardItemType.Image:
          if (item.content) {
            // For image type, we handle the base64 data
            // Extract the base64 part
            LogService.debug(
              `Paste image content starts with: ${item.content.substring(
                0,
                50
              )}...`
            );

            const base64Data = item.content.replace(
              /^data:image\/\w+;base64,/,
              ""
            );

            LogService.debug(`Image base64 data length: ${base64Data.length}`);

            try {
              await writeImage(base64Data);
              LogService.debug(`Successfully wrote image to clipboard`);
            } catch (e) {
              LogService.error(`Failed to write image to clipboard: ${e}`);
            }
          } else {
            LogService.error(`Cannot paste image: content is empty`);
          }
          break;

        default:
          throw new Error(`Unsupported clipboard item type: ${item.type}`);
      }

      // Then simulate paste using the Tauri command
      await invoke("simulate_paste");

      LogService.debug(`Pasted clipboard item of type ${item.type}`);
    } catch (error) {
      LogService.error(`Failed to paste clipboard item: ${error}`);
      throw error;
    }
  }

  /**
   * Get recent clipboard items
   */
  public async getRecentItems(
    limit: number = 30
  ): Promise<ClipboardHistoryItem[]> {
    try {
      LogService.debug(`Getting recent clipboard items (limit: ${limit})...`);
      const items = await getHistoryItems();

      // Ensure we don't exceed the limit and that we have valid items
      const validItems = items
        .filter((item) => item && item.id && item.type)
        .slice(0, limit);

      LogService.debug(
        `Retrieved ${validItems.length} clipboard history items`
      );
      return validItems;
    } catch (error) {
      LogService.error(`Error retrieving clipboard items: ${error}`);
      return [];
    }
  }

  /**
   * Helper to convert ArrayBuffer to Base64 string
   */
  private arrayBufferToBase64(buffer: Uint8Array): string {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;

    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }

    return window.btoa(binary);
  }

  /**
   * Helper to convert Base64 string back to Uint8Array
   */
  private base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);

    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return bytes;
  }
}
