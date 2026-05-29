import { invoke } from '@tauri-apps/api/core';
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
    return invoke<BrowserId[]>('browser_list_available_browsers');
  }

  async isCompanionInstalled(family: BrowserFamily): Promise<boolean> {
    return invoke<boolean>('browser_is_companion_installed', { family });
  }

  async listBookmarks(filter?: ListBookmarksFilter): Promise<Bookmark[]> {
    return invoke<Bookmark[]>('browser_list_bookmarks', {
      browser: filter?.browser,
      query: filter?.query,
    });
  }

  async searchHistory(
    query: string,
    opts?: SearchHistoryOptions,
  ): Promise<HistoryEntry[]> {
    return invoke<HistoryEntry[]>('browser_search_history', {
      query,
      limit: opts?.limit,
      sinceMs: opts?.sinceMs,
    });
  }

  async listTabs(filter?: { browser?: BrowserId; query?: string }): Promise<Tab[]> {
    return invoke<Tab[]>('browser_list_tabs', {
      browser: filter?.browser,
      query: filter?.query,
    });
  }

  async getActiveTab(browser?: BrowserId): Promise<Tab | null> {
    return invoke<Tab | null>('browser_get_active_tab', { browser });
  }

  async activateTab(tabId: string): Promise<void> {
    return invoke<void>('browser_activate_tab', { tabId });
  }

  async closeTab(tabId: string): Promise<void> {
    return invoke<void>('browser_close_tab', { tabId });
  }

  async openUrl(url: string, target?: OpenUrlTarget): Promise<void> {
    return invoke<void>('browser_open_url', { url, target });
  }

  async listPairedBrowsers(): Promise<BrowserKey[]> {
    return invoke<BrowserKey[]>('browser_list_paired_browsers');
  }

  async getCurrentPage(browser?: BrowserId): Promise<PageSnapshot | null> {
    return invoke<PageSnapshot | null>('browser_get_current_page', { browser });
  }

  async queryPage(tabId: string, selector: string, attrs?: string[]): Promise<PageMatch[]> {
    return invoke<PageMatch[]>('browser_query_page', { tabId, selector, attrs });
  }

  async actOnPage(tabId: string, action: PageAction): Promise<void> {
    return invoke<void>('browser_act_on_page', { tabId, action });
  }

  // — Plan A (command-bar additions) —

  async searchWeb(text: string, browser?: BrowserId): Promise<void> {
    return invoke<void>('browser_search_web', { text, browser });
  }

  async getMostRecentActiveBrowser(): Promise<BrowserKey | null> {
    return invoke<BrowserKey | null>('browser_get_most_recent_active_browser');
  }

  // — Per-kind subscribe methods. Each hard-codes `eventTypes` so the wire payload
  // cannot side-channel a different kind. See permissionGate.ts for the per-kind gates.
  async subscribeTabsChanged(): Promise<string> {
    return invoke<string>('browser_events_subscribe', { eventTypes: ['tabs.changed'] });
  }

  async unsubscribeTabsChanged(subscriptionId: string): Promise<void> {
    return invoke<void>('browser_events_unsubscribe', { subscriptionId });
  }

  async subscribePageChanged(): Promise<string> {
    return invoke<string>('browser_events_subscribe', { eventTypes: ['page.changed'] });
  }

  async unsubscribePageChanged(subscriptionId: string): Promise<void> {
    return invoke<void>('browser_events_unsubscribe', { subscriptionId });
  }
}

export const browserService = new BrowserService();
