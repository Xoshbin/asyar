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
  type: 'tabs-changed';
  browser: BrowserKey;
  tabs: Tab[];
}

export interface IBrowserService {
  // — Existing —

  /** Browsers detected on disk (have a readable data directory). No permission required. */
  listAvailableBrowsers(): Promise<BrowserId[]>;

  /** Returns true when the companion extension is currently paired for the given family. */
  isCompanionInstalled(family: BrowserFamily): Promise<boolean>;

  /** Reads bookmarks from on-disk files. Requires `browser:bookmarks.read`. */
  listBookmarks(filter?: ListBookmarksFilter): Promise<Bookmark[]>;

  /** Reads visit history from on-disk SQLite. Requires `browser:history.read`. */
  searchHistory(query: string, opts?: SearchHistoryOptions): Promise<HistoryEntry[]>;

  // — New in Plan 2 (companion bridge) —

  /** Lists open tabs from paired browsers. Requires `browser:tabs.read`. */
  listTabs(filter?: { browser?: BrowserId; query?: string }): Promise<Tab[]>;

  /** Returns the active tab for the given browser (or the frontmost paired browser). */
  getActiveTab(browser?: BrowserId): Promise<Tab | null>;

  /** Focuses the given tab. Requires `browser:tabs.control`. */
  activateTab(tabId: string): Promise<void>;

  /** Closes the given tab. Requires `browser:tabs.control`. */
  closeTab(tabId: string): Promise<void>;

  /** Opens the URL in the requested target. Requires `browser:openUrl`. */
  openUrl(url: string, target?: OpenUrlTarget): Promise<void>;

  /** Lists browser families/variants currently paired with the companion bridge. */
  listPairedBrowsers(): Promise<BrowserKey[]>;

  /**
   * Subscribe to live tab changes. Requires `browser:tabs.read` (gated at the
   * `browser:subscribeEvents` RPC in Rust).
   *
   * Returns a synchronous disposer — invoke it to unsubscribe. Listeners are
   * ref-counted: the first listener issues one `browser:subscribeEvents` RPC;
   * subsequent listeners reuse that subscription. The last disposer triggers
   * one `browser:unsubscribeEvents` RPC. The disposer is idempotent.
   */
  onTabsChanged(handler: (e: TabsChangedEvent) => void): () => void;
}
