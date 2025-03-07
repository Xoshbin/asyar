import type { ClipboardHistoryItem, ClipboardItemType } from "../../types";

/**
 * Interface for Clipboard History Service
 */
export interface IClipboardHistoryService {
  initialize(): Promise<void>;
  stopMonitoring(): void;
  formatClipboardItem(item: ClipboardHistoryItem): string;
  pasteItem(item: ClipboardHistoryItem): Promise<void>;
  hideWindow(): Promise<void>;
  simulatePaste(): Promise<boolean>;
  writeToClipboard(item: ClipboardHistoryItem): Promise<void>;
  getRecentItems(limit?: number): Promise<ClipboardHistoryItem[]>;
  toggleItemFavorite(itemId: string): Promise<boolean>;
  deleteItem(itemId: string): Promise<boolean>;
  clearNonFavorites(): Promise<boolean>;
  normalizeImageData(content: string): string;
  isValidImageData(content: string): boolean;
  readCurrentClipboard(): Promise<{ type: ClipboardItemType; content: string }>;
}
