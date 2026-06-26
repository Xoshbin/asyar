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

export class BrowserService {
  async listAvailableBrowsers(): Promise<BrowserId[]> {
    return (await browserListAvailableBrowsers()) ?? [];
  }

  async isCompanionInstalled(family: BrowserFamily): Promise<boolean> {
    return (await browserIsCompanionInstalled(family)) ?? false;
  }

  async listBookmarks(filter?: ListBookmarksFilter): Promise<Bookmark[]> {
    return (await browserListBookmarks(filter)) ?? [];
  }

  async searchHistory(
    query: string,
    opts?: SearchHistoryOptions,
  ): Promise<HistoryEntry[]> {
    return (await browserSearchHistory(query, opts)) ?? [];
  }

  async listTabs(filter?: { browser?: BrowserId; query?: string }): Promise<Tab[]> {
    return (await browserListTabs(filter)) ?? [];
  }

  async getActiveTab(browser?: BrowserId): Promise<Tab | null> {
    return browserGetActiveTab(browser);
  }

  async activateTab(tabId: string): Promise<void> {
    return browserActivateTab(tabId);
  }

  async closeTab(tabId: string): Promise<void> {
    return browserCloseTab(tabId);
  }

  async openUrl(url: string, target?: OpenUrlTarget): Promise<void> {
    return browserOpenUrl(url, target);
  }

  async listPairedBrowsers(): Promise<BrowserKey[]> {
    return (await browserListPairedBrowsers()) ?? [];
  }

  async getCurrentPage(browser?: BrowserId): Promise<PageSnapshot | null> {
    return browserGetCurrentPage(browser);
  }

  async queryPage(tabId: string, selector: string, attrs?: string[]): Promise<PageMatch[]> {
    return (await browserQueryPage(tabId, selector, attrs)) ?? [];
  }

  async actOnPage(tabId: string, action: PageAction): Promise<void> {
    return browserActOnPage(tabId, action);
  }

  // — Plan A (command-bar additions) —

  async searchWeb(text: string, browser?: BrowserId): Promise<void> {
    return browserSearchWeb(text, browser);
  }

  async getMostRecentActiveBrowser(): Promise<BrowserKey | null> {
    return browserGetMostRecentActiveBrowser();
  }

  // — Per-kind subscribe methods. Each hard-codes `eventTypes` so the wire payload
  // cannot side-channel a different kind. See permissionGate.ts for the per-kind gates.
  async subscribeTabsChanged(): Promise<string> {
    return (await browserSubscribeTabsChanged()) ?? '';
  }

  async unsubscribeTabsChanged(subscriptionId: string): Promise<void> {
    return browserUnsubscribeEvents(subscriptionId);
  }

  async subscribePageChanged(): Promise<string> {
    return (await browserSubscribePageChanged()) ?? '';
  }

  async unsubscribePageChanged(subscriptionId: string): Promise<void> {
    return browserUnsubscribeEvents(subscriptionId);
  }
}

export const browserService = new BrowserService();
