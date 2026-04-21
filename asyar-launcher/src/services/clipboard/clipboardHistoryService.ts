import {
  readText, readHTML, readImage, readFiles, readRTF,
  writeText, writeHTML, writeImage, writeRTF, writeFiles,
  hasText, hasHTML, hasImage, hasRTF, hasFiles,
  startListening, stopListening, onClipboardChange,
  type ReadClipboard,
} from "tauri-plugin-clipboard-x-api";
import { copyFile, remove, mkdir } from "@tauri-apps/plugin-fs";
import { appDataDir } from "@tauri-apps/api/path";
import { platform } from "@tauri-apps/plugin-os";
import { invoke } from '@tauri-apps/api/core';
import * as commands from "../../lib/ipc/commands";
import { v4 as uuidv4 } from "uuid";
import { clipboardHistoryStore } from "./stores/clipboardHistoryStore.svelte";
import { logService } from "../log/logService";
import { searchService } from "../search/SearchService";
import {
  ClipboardItemType,
  stripRtf,
  type ClipboardHistoryItem,
  type IClipboardHistoryService,
  type ClipboardSourceApp,
  type FrontmostApplication,
} from "asyar-sdk/contracts";

/**
 * Service for managing clipboard history
 */
export class ClipboardHistoryService implements IClipboardHistoryService {
  private unlistenClipboard: (() => void) | null = null;
  private isAndroid: boolean = false;
  private pollingInterval: number | null = null;

  private static readonly CLIPBOARD_CACHE_DIR = "clipboard_cache";
  private cacheDirPath: string | null = null;

  private async getCacheDirPath(): Promise<string> {
    if (!this.cacheDirPath) {
      const appData = await appDataDir();
      this.cacheDirPath = `${appData}${ClipboardHistoryService.CLIPBOARD_CACHE_DIR}`;
    }
    return this.cacheDirPath;
  }

  private async ensureCacheDir(): Promise<void> {
    const dir = await this.getCacheDirPath();
    await mkdir(dir, { recursive: true });
  }

  private async copyImageToCache(id: string, sourcePath: string): Promise<string> {
    await this.ensureCacheDir();
    const cacheDir = await this.getCacheDirPath();
    const destPath = `${cacheDir}/${id}.png`;
    await copyFile(sourcePath, destPath);
    return destPath;
  }

  private async deleteImageFromCache(path: string): Promise<void> {
    try {
      await remove(path);
    } catch {
      // File may not exist, that's ok
    }
  }

  /**
   * Initialize the clipboard history service
   */
  public async initialize(): Promise<void> {
    logService.debug("Initializing ClipboardHistoryService");
    await clipboardHistoryStore.init();

    try {
      const currentPlatform = await platform();
      this.isAndroid = currentPlatform === 'android';
      if (this.isAndroid) {
        logService.info('Running on Android — clipboard monitoring limited to text only');
      }
    } catch {
      // platform() may fail in test environments, default to non-Android
      this.isAndroid = false;
    }

    // Clean up legacy blob URL items (from pre-Phase 3 image storage)
    const items = await this.getRecentItems();
    const blobItems = items.filter(item => 
      item.type === ClipboardItemType.Image && 
      item.content?.startsWith('blob:')
    );
    if (blobItems.length > 0) {
      logService.info(`Cleaning up ${blobItems.length} legacy blob URL image items`);
      for (const item of blobItems) {
        await this.deleteItem(item.id);
      }
    }

    await this.startMonitoring();
    logService.debug("ClipboardHistoryService initialized");
  }

  /**
   * Start monitoring clipboard for changes
   */
  private async startMonitoring(): Promise<void> {
    if (this.unlistenClipboard || this.pollingInterval) return;
    
    if (this.isAndroid) {
      // Android: fall back to polling with text-only capture
      this.pollingInterval = setInterval(async () => {
        await this.captureCurrentClipboardForAndroid();
      }, 1000) as unknown as number;
      logService.debug("Started clipboard monitoring (Android polling)");
      return;
    }

    // Desktop: event-driven monitoring
    await startListening();
    this.unlistenClipboard = await onClipboardChange(async (result: ReadClipboard) => {
      await this.handleClipboardChange(result);
    });
    
    logService.debug("Started clipboard monitoring (event-driven)");
  }

  /**
   * Android-specific clipboard capture (text only via polling)
   */
  private async captureCurrentClipboardForAndroid(): Promise<void> {
    try {
      const hasTextContent = await hasText();
      if (hasTextContent) {
        const text = await readText();
        if (text) {
          await this.captureTextContent(text);
        }
      }
    } catch (error) {
      logService.error(`Android clipboard capture error: ${error}`);
    }
  }

  /**
   * Stop monitoring clipboard
   */
  public async stopMonitoring(): Promise<void> {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.unlistenClipboard?.();
    this.unlistenClipboard = null;
    
    if (!this.isAndroid) {
      try {
        await stopListening();
      } catch {
        /* may not be listening */
      }
    }
    logService.debug("Stopped clipboard monitoring");
  }

  private async captureSourceApp(): Promise<ClipboardSourceApp | undefined> {
    try {
      const frontmost = await invoke<FrontmostApplication>('get_frontmost_application');
      if (!frontmost?.name) return undefined;
      return {
        name: frontmost.name,
        bundleId: frontmost.bundleId ?? undefined,
        path: frontmost.path ?? undefined,
        windowTitle: frontmost.windowTitle ?? undefined,
      };
    } catch (error) {
      logService.debug(`Failed to capture source app: ${error}`);
      return undefined;
    }
  }

  /**
   * Handle clipboard changes from the event listener
   */
  private async handleClipboardChange(result: ReadClipboard): Promise<void> {
    const sourceApp = await this.captureSourceApp();
    try {
      if (result.files?.value?.length) {
        await this.captureFileContent(result.files, sourceApp);
      } else if (result.image?.value) {
        await this.captureImageContent(result.image, sourceApp);
      } else if (result.html?.value) {
        await this.captureHtmlContent(result.html.value, sourceApp);
      } else if (result.rtf?.value) {
        await this.captureRtfContent(result.rtf.value, sourceApp);
      } else if (result.text?.value) {
        await this.captureTextContent(result.text.value, sourceApp);
      }
    } catch (error) {
      logService.error(`Error handling clipboard change: ${error}`);
    }
  }

  /**
   * Capture text content from clipboard
   */
  private async captureTextContent(text: string, sourceApp?: ClipboardSourceApp): Promise<void> {
    try {
      if (!text) return;

      const item: ClipboardHistoryItem = {
        id: uuidv4(),
        type: ClipboardItemType.Text,
        content: text,
        preview: this.createPreview(text, ClipboardItemType.Text),
        createdAt: Date.now(),
        favorite: false,
        sourceApp,
      };

      await clipboardHistoryStore.addHistoryItem(item);
    } catch (error) {
      logService.error(`Error capturing text content: ${error}`);
    }
  }

  /**
   * Capture HTML content from clipboard
   */
  private async captureHtmlContent(html: string, sourceApp?: ClipboardSourceApp): Promise<void> {
    try {
      if (!html) return;

      const item: ClipboardHistoryItem = {
        id: uuidv4(),
        type: ClipboardItemType.Html,
        content: html,
        preview: this.createPreview(html, ClipboardItemType.Html),
        createdAt: Date.now(),
        favorite: false,
        sourceApp,
      };

      await clipboardHistoryStore.addHistoryItem(item);
    } catch (error) {
      logService.error(`Error capturing HTML content: ${error}`);
    }
  }

  /**
   * Capture image content from clipboard
   */
  private async captureImageContent(
    imageData: { value: string; width: number; height: number },
    sourceApp?: ClipboardSourceApp,
  ): Promise<void> {
    try {
      if (!imageData?.value) return;

      const imageId = uuidv4();
      let storedPath = imageData.value; // fallback to temp path

      try {
        storedPath = await this.copyImageToCache(imageId, imageData.value);
      } catch (error) {
        logService.error(`Failed to copy image to cache, using temp path: ${error}`);
      }

      const item: ClipboardHistoryItem = {
        id: imageId,
        type: ClipboardItemType.Image,
        content: storedPath,
        preview: `Image: ${imageData.width}×${imageData.height}`,
        createdAt: Date.now(),
        favorite: false,
        metadata: {
          width: imageData.width,
          height: imageData.height,
        },
        sourceApp,
      };

      await clipboardHistoryStore.addHistoryItem(item);
    } catch (error) {
      logService.error(`Error capturing image content: ${error}`);
    }
  }

  /**
   * Capture RTF content from clipboard
   */
  private async captureRtfContent(rtf: string, sourceApp?: ClipboardSourceApp): Promise<void> {
    try {
      if (!rtf) return;

      const item: ClipboardHistoryItem = {
        id: uuidv4(),
        type: ClipboardItemType.Rtf,
        content: rtf,
        preview: this.truncateText(stripRtf(rtf)),
        createdAt: Date.now(),
        favorite: false,
        sourceApp,
      };

      await clipboardHistoryStore.addHistoryItem(item);
    } catch (error) {
      logService.error(`Error capturing RTF content: ${error}`);
    }
  }

  /**
   * Capture file paths from clipboard
   */
  private async captureFileContent(
    fileData: { value: string[]; count: number },
    sourceApp?: ClipboardSourceApp,
  ): Promise<void> {
    try {
      if (!fileData?.value?.length) return;

      const contentStr = JSON.stringify(fileData.value);

      const fileNames = fileData.value.map(p => {
        const parts = p.replace(/\\/g, '/').split('/');
        return parts[parts.length - 1] || p;
      });

      const item: ClipboardHistoryItem = {
        id: uuidv4(),
        type: ClipboardItemType.Files,
        content: contentStr,
        preview: `${fileData.count} file${fileData.count !== 1 ? 's' : ''}: ${fileNames.join(', ')}`,
        createdAt: Date.now(),
        favorite: false,
        metadata: {
          fileCount: fileData.count,
          fileNames,
        },
        sourceApp,
      };

      await clipboardHistoryStore.addHistoryItem(item);
    } catch (error) {
      logService.error(`Error capturing file content: ${error}`);
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

    if (item.type === ClipboardItemType.Files) {
      try {
        const paths: string[] = JSON.parse(item.content || '[]');
        return `${paths.length} file${paths.length !== 1 ? 's' : ''} copied`;
      } catch {
        return 'Files copied';
      }
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
      await searchService.saveIndex();
      await commands.hideWindow();
    } catch (error) {
      logService.error(`Failed to hide window: ${error}`);
    }
  }

  /**
   * Simulate paste operation using system keyboard shortcut
   */
  public async simulatePaste(): Promise<boolean> {
    try {
      await commands.simulatePaste();
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

    if (this.isAndroid && (item.type === ClipboardItemType.Html || item.type === ClipboardItemType.Rtf)) {
      // Android: write as plain text fallback
      let plaintext = item.content || '';
      if (item.type === ClipboardItemType.Html) {
        plaintext = plaintext.replace(/<[^>]*>/g, '');
      } else if (item.type === ClipboardItemType.Rtf) {
        plaintext = plaintext
          .replace(/\\[a-z]+\d*\s?/gi, '')
          .replace(/[{}]/g, '')
          .trim() || plaintext;
      }
      await writeText(plaintext);
      return;
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

      case ClipboardItemType.Rtf:
        await this.writeRtfContent(item.content);
        break;

      case ClipboardItemType.Files:
        await this.writeFileContent(item.content);
        break;

      default:
        throw new Error(`Unsupported clipboard item type: ${item.type}`);
    }
  }

  /**
   * Write HTML content to clipboard with fallback
   */
  private async writeHtmlContent(html: string): Promise<void> {
    const div = document.createElement("div");
    div.innerHTML = html;
    const plainText = div.textContent || div.innerText || "";

    await writeHTML(plainText, html);
  }

  /**
   * Write image content to clipboard
   */
  private async writeImageContent(imageData: string): Promise<void> {
    logService.debug(`Writing image to clipboard`);

    if (imageData.startsWith('data:')) {
      // Legacy backward compat: old items stored as data URIs
      // For now, log a warning — these can't be written back with the new plugin
      logService.warn('Cannot write legacy data URI image to clipboard');
      return;
    }

    await writeImage(imageData);
  }

  /**
   * Write RTF content to clipboard
   */
  private async writeRtfContent(rtf: string): Promise<void> {
    // Extract plain text from RTF by stripping RTF control words
    // Simple approach: remove commands and then braces
    const plainText = rtf
      .replace(/\\[a-z]+\d*\s?/gi, '')
      .replace(/[{}]/g, '')
      .trim() || rtf;

    await writeRTF(plainText, rtf);
  }

  /**
   * Write file paths to clipboard
   */
  private async writeFileContent(content: string): Promise<void> {
    try {
      const paths: string[] = JSON.parse(content);
      await writeFiles(paths);
    } catch (error) {
      logService.error(`Failed to write files to clipboard: ${error}`);
      throw error;
    }
  }

  /**
   * Get recent clipboard items
   */
  public async getRecentItems(limit = 30): Promise<ClipboardHistoryItem[]> {
    try {
      const items = await clipboardHistoryStore.getHistoryItems();

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
      await clipboardHistoryStore.toggleFavorite(itemId);
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
      // Look up the item to check if it's an image that needs cache cleanup
      const items = await clipboardHistoryStore.getHistoryItems();
      const item = items.find(i => i.id === itemId);

      if (item?.type === ClipboardItemType.Image && item.content) {
        await this.deleteImageFromCache(item.content);
      }

      await clipboardHistoryStore.deleteHistoryItem(itemId);
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
      // Delete cached images for non-favorite items before clearing
      const items = await clipboardHistoryStore.getHistoryItems();
      for (const item of items) {
        if (!item.favorite && item.type === ClipboardItemType.Image && item.content) {
          await this.deleteImageFromCache(item.content);
        }
      }

      await clipboardHistoryStore.clearHistory();
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
   */
  public async readCurrentClipboard(): Promise<{
    type: ClipboardItemType;
    content: string;
  }> {
    try {
      if (await hasImage()) {
        const img = await readImage();
        if (img?.path) {
          return { type: ClipboardItemType.Image, content: img.path };
        }
      }
      
      if (await hasHTML()) {
        const html = await readHTML();
        if (html) {
          return { type: ClipboardItemType.Html, content: html };
        }
      }

      if (await hasRTF()) {
        const rtf = await readRTF();
        if (rtf) {
          return { type: ClipboardItemType.Rtf, content: rtf };
        }
      }

      if (await hasFiles()) {
        const files = await readFiles();
        if (files?.paths?.length) {
          return { type: ClipboardItemType.Files, content: JSON.stringify(files.paths) };
        }
      }

      const text = await readText();
      if (text) {
        return { type: ClipboardItemType.Text, content: text };
      }

      return { type: ClipboardItemType.Text, content: "" };
    } catch (error) {
      logService.error(`Failed to read from clipboard: ${error}`);
      return { type: ClipboardItemType.Text, content: "" };
    }
  }

  /**
   * Read the current clipboard as plain text only.
   *
   * Unlike `readCurrentClipboard`, this does not care about HTML/RTF/image/files
   * flavors — it asks the OS for the plain-text representation directly. This is
   * what consumers want when they need text to feed into another system (search,
   * URL templates, snippets, etc.) regardless of what format the user copied from.
   */
  public async readCurrentText(): Promise<string> {
    try {
      const text = await readText();
      return text ?? "";
    } catch (error) {
      logService.error(`Failed to read text from clipboard: ${error}`);
      return "";
    }
  }
}

export const clipboardHistoryService = new ClipboardHistoryService();
