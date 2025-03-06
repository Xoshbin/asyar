// Define types for clipboard items
export enum ClipboardItemType {
  Text = "text",
  Html = "html",
  Image = "image",
}

/**
 * Simplified clipboard history item safe for external exposure
 */
export interface ClipboardHistoryItem {
  id: string;
  type: ClipboardItemType;
  content?: string; // Only for text/HTML (omitted for binary data)
  preview?: string;
  createdAt: number;
  favorite: boolean;
}
