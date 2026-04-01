/**
 * Types of content that can be stored in the clipboard
 */
export enum ClipboardItemType {
  Text = "text",
  Html = "html",
  Rtf = "rtf",
  Image = "image",
  Files = "files",
}

/**
 * Optional metadata for clipboard items
 */
export interface ClipboardItemMetadata {
  width?: number;
  height?: number;
  fileCount?: number;
  fileNames?: string[];
  sizeBytes?: number;
  mimeType?: string;
}

/**
 * Interface for clipboard history items that can be safely exposed externally
 */
export interface ClipboardHistoryItem {
  id: string;
  type: ClipboardItemType;
  content?: string;
  preview?: string;
  createdAt: number;
  favorite: boolean;
  metadata?: ClipboardItemMetadata;
}
