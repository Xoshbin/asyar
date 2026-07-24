import {
  browserListAvailableBrowsers,
  browserIsCompanionInstalled,
  browserListBookmarks,
  browserSearchHistory,
  browserListTabs,
  browserGetActiveTab,
  browserActivateTab,
  browserCloseTab,
  browserOpenUrl,
  browserListPairedBrowsers,
  browserGetCurrentPage,
  browserQueryPage,
  browserActOnPage,
  browserSearchWeb,
  browserGetMostRecentActiveBrowser,
  browserSubscribeTabsChanged,
  browserUnsubscribeEvents,
  browserSubscribePageChanged,
} from '../../lib/ipc/browserCommands';
import type {
  Bookmark,
  BrowserFamily,
  BrowserId,
  BrowserKey,
  HistoryEntry,
  ListBookmarksFilter,
  OpenUrlTarget,
  SearchHistoryOptions,
  Tab,
  PageSnapshot,
  PageMatch,
  PageAction,
} from 'asyar-sdk/contracts';

/**
 * The `browser` namespace is in ALWAYS_INJECTS_CALLER_ID, so every method
 * receives the router-verified caller identity first — `null` for
 * privileged host-context calls (and for direct host-side imports, which
 * pass `null` themselves). Only `openUrl` uses it: the Rust command
 * scheme-gates extension callers, because its OsDefault branch reaches the
 * opener plugin's scope-free Rust-side `open_url`.
 */
export class BrowserService {
  async listAvailableBrowsers(callerExtensionId: string | null): Promise<BrowserId[]> {
    return (await browserListAvailableBrowsers()) ?? [];
  }

  async isCompanionInstalled(
    callerExtensionId: string | null,
    family: BrowserFamily,
  ): Promise<boolean> {
    return (await browserIsCompanionInstalled(family)) ?? false;
  }

  async listBookmarks(
    callerExtensionId: string | null,
    filter?: ListBookmarksFilter,
  ): Promise<Bookmark[]> {
    return (await browserListBookmarks(filter)) ?? [];
  }

  async searchHistory(
    callerExtensionId: string | null,
    query: string,
    opts?: SearchHistoryOptions,
  ): Promise<HistoryEntry[]> {
    return (await browserSearchHistory(query, opts)) ?? [];
  }

  async listTabs(
    callerExtensionId: string | null,
    filter?: { browser?: BrowserId; query?: string },
  ): Promise<Tab[]> {
    return (await browserListTabs(filter)) ?? [];
  }

  async getActiveTab(callerExtensionId: string | null, browser?: BrowserId): Promise<Tab | null> {
    return browserGetActiveTab(browser);
  }

  async activateTab(callerExtensionId: string | null, tabId: string): Promise<void> {
    return browserActivateTab(tabId);
  }

  async closeTab(callerExtensionId: string | null, tabId: string): Promise<void> {
    return browserCloseTab(tabId);
  }

  async openUrl(
    callerExtensionId: string | null,
    url: string,
    target?: OpenUrlTarget,
  ): Promise<void> {
    return browserOpenUrl(callerExtensionId, url, target);
  }

  async listPairedBrowsers(callerExtensionId: string | null): Promise<BrowserKey[]> {
    return (await browserListPairedBrowsers()) ?? [];
  }

  async getCurrentPage(
    callerExtensionId: string | null,
    browser?: BrowserId,
  ): Promise<PageSnapshot | null> {
    return browserGetCurrentPage(browser);
  }

  async queryPage(
    callerExtensionId: string | null,
    tabId: string,
    selector: string,
    attrs?: string[],
  ): Promise<PageMatch[]> {
    return (await browserQueryPage(tabId, selector, attrs)) ?? [];
  }

  async actOnPage(
    callerExtensionId: string | null,
    tabId: string,
    action: PageAction,
  ): Promise<void> {
    return browserActOnPage(tabId, action);
  }

  // — Plan A (command-bar additions) —

  async searchWeb(
    callerExtensionId: string | null,
    text: string,
    browser?: BrowserId,
  ): Promise<void> {
    return browserSearchWeb(text, browser);
  }

  async getMostRecentActiveBrowser(callerExtensionId: string | null): Promise<BrowserKey | null> {
    return browserGetMostRecentActiveBrowser();
  }

  // — Per-kind subscribe methods. Each hard-codes `eventTypes` so the wire payload
  // cannot side-channel a different kind. Per-kind permissions are enforced in
  // src-tauri/src/permissions.rs (get_required_permission).
  async subscribeTabsChanged(callerExtensionId: string | null): Promise<string> {
    return (await browserSubscribeTabsChanged()) ?? '';
  }

  async unsubscribeTabsChanged(
    callerExtensionId: string | null,
    subscriptionId: string,
  ): Promise<void> {
    return browserUnsubscribeEvents(subscriptionId);
  }

  async subscribePageChanged(callerExtensionId: string | null): Promise<string> {
    return (await browserSubscribePageChanged()) ?? '';
  }

  async unsubscribePageChanged(
    callerExtensionId: string | null,
    subscriptionId: string,
  ): Promise<void> {
    return browserUnsubscribeEvents(subscriptionId);
  }
}

export const browserService = new BrowserService();
