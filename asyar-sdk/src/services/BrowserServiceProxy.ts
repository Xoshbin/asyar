import { BaseServiceProxy } from './BaseServiceProxy';
import type {
  Bookmark,
  BrowserFamily,
  BrowserId,
  BrowserKey,
  HistoryEntry,
  IBrowserService,
  ListBookmarksFilter,
  OpenUrlTarget,
  SearchHistoryOptions,
  Tab,
  TabsChangedEvent,
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

  listTabs(filter?: { browser?: BrowserId; query?: string }): Promise<Tab[]> {
    return this.broker.invoke<Tab[]>(
      'browser:listTabs',
      { filter: filter ?? {} },
      undefined,
      5000,
    );
  }

  getActiveTab(browser?: BrowserId): Promise<Tab | null> {
    return this.broker.invoke<Tab | null>(
      'browser:getActiveTab',
      { browser },
      undefined,
      5000,
    );
  }

  activateTab(tabId: string): Promise<void> {
    return this.broker.invoke<void>('browser:activateTab', { tabId }, undefined, 5000);
  }

  closeTab(tabId: string): Promise<void> {
    return this.broker.invoke<void>('browser:closeTab', { tabId }, undefined, 5000);
  }

  openUrl(url: string, target?: OpenUrlTarget): Promise<void> {
    return this.broker.invoke<void>(
      'browser:openUrl',
      { url, target: target ?? {} },
      undefined,
      5000,
    );
  }

  listPairedBrowsers(): Promise<BrowserKey[]> {
    return this.broker.invoke<BrowserKey[]>(
      'browser:listPairedBrowsers',
      {},
      undefined,
      5000,
    );
  }

  onTabsChanged(handler: (e: TabsChangedEvent) => void): () => Promise<void> {
    const wrapped = (payload: unknown) => handler(payload as TabsChangedEvent);
    this.broker.on('browser:tabs-changed', wrapped);
    return async () => {
      this.broker.off('browser:tabs-changed', wrapped);
    };
  }
}
