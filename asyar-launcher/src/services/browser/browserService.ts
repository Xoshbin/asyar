import { invoke } from '@tauri-apps/api/core';
import type {
  Bookmark,
  BrowserFamily,
  BrowserId,
  HistoryEntry,
  IBrowserService,
  ListBookmarksFilter,
  SearchHistoryOptions,
} from 'asyar-sdk/contracts';

export class BrowserService implements IBrowserService {
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
}

export const browserService = new BrowserService();
