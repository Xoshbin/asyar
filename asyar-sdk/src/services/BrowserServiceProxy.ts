import { BaseServiceProxy } from './BaseServiceProxy';
import type {
  Bookmark,
  BrowserFamily,
  BrowserId,
  HistoryEntry,
  IBrowserService,
  ListBookmarksFilter,
  SearchHistoryOptions,
} from './IBrowserService';

export class BrowserServiceProxy extends BaseServiceProxy implements IBrowserService {
  listAvailableBrowsers(): Promise<BrowserId[]> {
    return this.broker.invoke<BrowserId[]>('browser:listAvailableBrowsers', {}, undefined, 5000);
  }

  isCompanionInstalled(family: BrowserFamily): Promise<boolean> {
    return this.broker.invoke<boolean>(
      'browser:isCompanionInstalled',
      { family },
      undefined,
      5000,
    );
  }

  listBookmarks(filter?: ListBookmarksFilter): Promise<Bookmark[]> {
    return this.broker.invoke<Bookmark[]>(
      'browser:listBookmarks',
      { filter: filter ?? {} },
      undefined,
      5000,
    );
  }

  searchHistory(query: string, opts?: SearchHistoryOptions): Promise<HistoryEntry[]> {
    return this.broker.invoke<HistoryEntry[]>(
      'browser:searchHistory',
      { query, opts: opts ?? {} },
      undefined,
      5000,
    );
  }
}
