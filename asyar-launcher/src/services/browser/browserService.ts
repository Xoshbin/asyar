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
}

export const browserService = new BrowserService();
