export type BrowserFamily = 'chromium' | 'firefox' | 'safari';

export interface BrowserId {
  family: BrowserFamily;
  // Variant within the family (e.g. 'chrome', 'brave', 'arc', 'edge', 'vivaldi', 'firefox', 'librewolf', 'safari').
  variant: string;
  // Profile directory name relative to the browser's user-data root (e.g. 'Default', 'Profile 1').
  profileId: string;
}

export interface Bookmark {
  id: string;
  browser: BrowserId;
  title: string;
  url: string;
  // Path from the bookmark tree root, e.g. ['Bookmarks Bar', 'Work'].
  folderPath: string[];
  // Unix epoch milliseconds. May be 0 if the source file does not record it.
  addedAt: number;
}

export interface HistoryEntry {
  url: string;
  title: string;
  browser: BrowserId;
  // Unix epoch milliseconds.
  lastVisitAt: number;
  visitCount: number;
}

export interface ListBookmarksFilter {
  browser?: BrowserId;
  query?: string;
}

export interface SearchHistoryOptions {
  limit?: number;
  // Only return entries with lastVisitAt >= sinceMs (unix epoch ms).
  sinceMs?: number;
}

export interface IBrowserService {
  /** Browsers detected on disk (have a readable data directory). No permission required. */
  listAvailableBrowsers(): Promise<BrowserId[]>;

  /** Always returns false in this milestone — companion bridge ships in Plan 2. */
  isCompanionInstalled(family: BrowserFamily): Promise<boolean>;

  /** Reads bookmarks from on-disk files. Requires `browser:bookmarks.read`. */
  listBookmarks(filter?: ListBookmarksFilter): Promise<Bookmark[]>;

  /** Reads visit history from on-disk SQLite. Requires `browser:history.read`. */
  searchHistory(query: string, opts?: SearchHistoryOptions): Promise<HistoryEntry[]>;
}

export interface Tab {
  id: string;
  browser: BrowserId;
  windowId: string;
  index: number;
  title: string;
  url: string;
  faviconUrl?: string;
  isActive: boolean;
  isPinned: boolean;
  isAudible: boolean;
  groupName?: string;
}

export interface OpenUrlTarget {
  browser?: BrowserId;
  newWindow?: boolean;
}

export interface BrowserKey {
  family: BrowserFamily;
  variant: string;
}

export interface TabsChangedEvent {
  family: BrowserFamily;
  variant: string;
  tabs: Tab[];
}
