// asyar-launcher/src/lib/ipc/clipboardHistoryCommands.ts
// Tauri command wrappers, re-exported through ./commands (the barrel).
import { invokeSafe } from './invokeSafe';

// ── Storage: Clipboard ───────────────────────────────────────────────────────

export interface StoredClipboardItem {
  id: string;
  type: string;
  content?: string;
  preview?: string;
  createdAt: number;
  favorite: boolean;
  metadata?: Record<string, unknown>;
  sourceApp?: Record<string, unknown>;
  redactedKinds?: string[];
}

export interface StoredClipboardListItem {
  id: string;
  type: string;
  preview?: string;
  createdAt: number;
  favorite: boolean;
  metadata?: Record<string, unknown>;
  sourceApp?: Record<string, unknown>;
  redactedKinds?: string[];
}

export interface ClipboardCursor {
  createdAt: number;
  id: string;
}

export interface ClipboardInitialPage {
  favorites: StoredClipboardListItem[];
  recent: StoredClipboardListItem[];
  nextCursor?: ClipboardCursor;
}

export interface ClipboardOlderPage {
  items: StoredClipboardListItem[];
  nextCursor?: ClipboardCursor;
}

export interface ClipboardExportPage {
  items: StoredClipboardItem[];
  nextCursor?: ClipboardCursor;
}

export interface ClipboardSearchResult {
  items: StoredClipboardListItem[];
  indexState: 'ready' | 'indexing';
}

export interface ClipboardCount {
  total: number;
  favorites: number;
}

export interface ClipboardCaptureResult {
  insertedId: string;
  evictedIds: string[];
}

export interface ClipboardDeleteResult {
  imageContentPath?: string;
}

export interface ClipboardClearResult {
  removedIds: string[];
  removedImagePaths: string[];
}

export async function clipboardListInitial(limit: number): Promise<ClipboardInitialPage | null> {
  return invokeSafe<ClipboardInitialPage>('clipboard_list_initial', { limit });
}

export async function clipboardListOlder(
  cursor: ClipboardCursor,
  limit: number,
): Promise<ClipboardOlderPage | null> {
  return invokeSafe<ClipboardOlderPage>('clipboard_list_older', { cursor, limit });
}

export async function clipboardSearch(
  query: string,
  limit: number,
): Promise<ClipboardSearchResult | null> {
  return invokeSafe<ClipboardSearchResult>('clipboard_search', { query, limit });
}

export async function clipboardGetItem(id: string): Promise<StoredClipboardItem | null> {
  return invokeSafe<StoredClipboardItem | null>('clipboard_get_item', { id });
}

export interface MergedClipboardText {
  text: string;
  skippedCount: number;
}

/** Fetch, decrypt, strip HTML/RTF, and join multiple items' text server-side
 *  (in the given order). Image/Files items are skipped and counted. Used by
 *  the clipboard-history multi-select merge-paste flow. */
export async function clipboardGetMergedText(ids: string[]): Promise<MergedClipboardText | null> {
  return invokeSafe<MergedClipboardText>('clipboard_get_merged_text', { ids });
}

export async function clipboardExportForSync(
  cursor: ClipboardCursor | undefined,
  limit: number,
): Promise<ClipboardExportPage | null> {
  return invokeSafe<ClipboardExportPage>('clipboard_export_for_sync', { cursor, limit });
}

export async function clipboardCount(): Promise<ClipboardCount | null> {
  return invokeSafe<ClipboardCount>('clipboard_count');
}

export async function clipboardRecordCapture(
  item: StoredClipboardItem,
): Promise<ClipboardCaptureResult | null> {
  return invokeSafe<ClipboardCaptureResult>('clipboard_record_capture', { item });
}

export async function clipboardToggleFavorite(id: string): Promise<boolean | null> {
  return invokeSafe<boolean>('clipboard_toggle_favorite', { id });
}

export async function clipboardDeleteItem(id: string): Promise<ClipboardDeleteResult | null> {
  return invokeSafe<ClipboardDeleteResult>('clipboard_delete_item', { id });
}

export async function clipboardClearNonFavorites(): Promise<ClipboardClearResult | null> {
  return invokeSafe<ClipboardClearResult>('clipboard_clear_non_favorites');
}
