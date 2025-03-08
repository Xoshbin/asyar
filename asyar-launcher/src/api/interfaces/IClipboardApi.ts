import type {
  ClipboardHistoryItem,
  ClipboardItemType,
} from "../../types/clipboard";

/**
 * Interface for Clipboard API operations
 */
export interface IClipboardApi {
  /**
   * Read current clipboard content
   */
  read(): Promise<{ type: ClipboardItemType; content: string }>;

  /**
   * Write content to clipboard
   */
  write(type: ClipboardItemType, content: string): Promise<boolean>;

  /**
   * Get recent clipboard history items
   */
  getHistory(limit?: number): Promise<ClipboardHistoryItem[]>;

  /**
   * Simulate a paste operation for a history item
   */
  pasteHistoryItem(itemId: string): Promise<boolean>;

  /**
   * Format a clipboard item for display
   */
  formatClipboardItem(item: ClipboardHistoryItem): string;

  /**
   * Simulates a paste operation using system keyboard shortcut
   */
  simulatePaste(): Promise<boolean>;

  /**
   * Toggle favorite status for a clipboard history item
   */
  toggleFavorite(itemId: string): Promise<boolean>;

  /**
   * Delete a clipboard history item
   */
  deleteHistoryItem(itemId: string): Promise<boolean>;

  /**
   * Clear all non-favorite clipboard history items
   */
  clearHistory(): Promise<boolean>;
}
