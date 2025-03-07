/**
 * Types of content that can be stored in the clipboard
 */
export enum ClipboardItemType {
  Text = "text",
  Html = "html",
  Image = "image",
}

/**
 * Interface for clipboard history items that can be safely exposed externally
 */
export interface ClipboardHistoryItem {
  id: string;
  type: ClipboardItemType;
  content?: string; // Optional - omitted for binary data
  preview?: string;
  createdAt: number;
  favorite: boolean;
}
