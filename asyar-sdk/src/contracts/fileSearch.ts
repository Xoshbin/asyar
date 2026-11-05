/**
 * Remote / Cloud File Search SPI contracts.
 * Allows Tier 2 extensions (e.g. Google Drive, Notion, OneDrive) to contribute
 * remote file search results to Asyar's unified search.
 */

export interface FileSearchResultItem {
  /** Unique identifier within this provider (e.g. Drive file ID or Notion page ID). */
  id: string;
  /** File title / document name (e.g. "Q3 Financial Plan 2026"). */
  title: string;
  /** Subtitle or location hierarchy (e.g. "Finance / Shared Drive"). */
  container?: string;
  /** Remote web URL to open the document in a browser. */
  url?: string;
  /** Optional local disk path if mirrored/cached locally. */
  path?: string;
  /** Standard icon key (e.g. "icon:file", "icon:doc") or custom icon URL. */
  icon?: string;
  /** MIME type (e.g. "application/vnd.google-apps.spreadsheet"). */
  mimeType?: string;
  /** Timestamp of last modification in epoch milliseconds. */
  modifiedAt?: number;
  /** File size in bytes. */
  size?: number;
}

export interface FileSearchQuery {
  /** User's typed query string. */
  query: string;
  /** Requested maximum number of results. */
  limit: number;
}

export type FileSearchHandler = (
  query: FileSearchQuery,
  signal: AbortSignal,
) => Promise<FileSearchResultItem[]>;

export interface FileSearchProviderRegistration {
  /** Provider ID matching the manifest declaration (e.g. "gdrive"). */
  id: string;
  /** Handler function invoked when a file search query is dispatched. */
  search: FileSearchHandler;
}

export interface ManifestFileSearchProvider {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  requiresAuth?: boolean;
  defaultEnabled?: boolean;
}
