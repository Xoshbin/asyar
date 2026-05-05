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
 * Source application info captured at copy time.
 * bundleId is set on macOS; path is set on Windows/Linux (and macOS bundle path).
 * iconUrl is resolved from the icon cache at capture time — may be absent.
 */
export interface ClipboardSourceApp {
  name: string;
  bundleId?: string;
  path?: string;
  windowTitle?: string;
  iconUrl?: string;
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
  sourceApp?: ClipboardSourceApp;
  /**
   * Set when Asyar's secret detector matched and redacted one or more
   * substrings in this item's content. Each entry is the kind name from
   * the bundled detector catalog (e.g. `"aws_access_key"`, `"jwt"`,
   * `"credit_card"`). Extensions should display a "secret hidden"
   * indicator when this field is present and non-empty. The original
   * (pre-redaction) content is NOT stored.
   */
  redactedKinds?: string[];
}
