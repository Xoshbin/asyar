import { invokeSafe } from './invokeSafe';
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

export async function browserListAvailableBrowsers(): Promise<BrowserId[] | null> {
  return invokeSafe<BrowserId[]>('browser_list_available_browsers');
}

export async function browserIsCompanionInstalled(family: BrowserFamily): Promise<boolean | null> {
  return invokeSafe<boolean>('browser_is_companion_installed', { family });
}

export async function browserListBookmarks(filter?: ListBookmarksFilter): Promise<Bookmark[] | null> {
  return invokeSafe<Bookmark[]>('browser_list_bookmarks', {
    browser: filter?.browser,
    query: filter?.query,
  });
}

export async function browserSearchHistory(
  query: string,
  opts?: SearchHistoryOptions,
): Promise<HistoryEntry[] | null> {
  return invokeSafe<HistoryEntry[]>('browser_search_history', {
    query,
    limit: opts?.limit,
    sinceMs: opts?.sinceMs,
  });
}

export async function browserListTabs(
  filter?: { browser?: BrowserId; query?: string },
): Promise<Tab[] | null> {
  return invokeSafe<Tab[]>('browser_list_tabs', {
    browser: filter?.browser,
    query: filter?.query,
  });
}

export async function browserGetActiveTab(browser?: BrowserId): Promise<Tab | null> {
  return invokeSafe<Tab | null>('browser_get_active_tab', { browser });
}

export async function browserActivateTab(tabId: string): Promise<void> {
  await invokeSafe('browser_activate_tab', { tabId });
}

export async function browserCloseTab(tabId: string): Promise<void> {
  await invokeSafe('browser_close_tab', { tabId });
}

export async function browserOpenUrl(url: string, target?: OpenUrlTarget): Promise<void> {
  await invokeSafe('browser_open_url', { url, target });
}

export async function browserListPairedBrowsers(): Promise<BrowserKey[] | null> {
  return invokeSafe<BrowserKey[]>('browser_list_paired_browsers');
}

export async function browserGetCurrentPage(browser?: BrowserId): Promise<PageSnapshot | null> {
  return invokeSafe<PageSnapshot | null>('browser_get_current_page', { browser });
}

export async function browserQueryPage(
  tabId: string,
  selector: string,
  attrs?: string[],
): Promise<PageMatch[] | null> {
  return invokeSafe<PageMatch[]>('browser_query_page', { tabId, selector, attrs });
}

export async function browserActOnPage(tabId: string, action: PageAction): Promise<void> {
  await invokeSafe('browser_act_on_page', { tabId, action });
}

export async function browserSearchWeb(text: string, browser?: BrowserId): Promise<void> {
  await invokeSafe('browser_search_web', { text, browser });
}

export async function browserGetMostRecentActiveBrowser(): Promise<BrowserKey | null> {
  return invokeSafe<BrowserKey | null>('browser_get_most_recent_active_browser');
}

export async function browserSubscribeTabsChanged(): Promise<string | null> {
  return invokeSafe<string>('browser_events_subscribe', { eventTypes: ['tabs.changed'] });
}

export async function browserUnsubscribeEvents(subscriptionId: string): Promise<void> {
  await invokeSafe('browser_events_unsubscribe', { subscriptionId });
}

export async function browserSubscribePageChanged(): Promise<string | null> {
  return invokeSafe<string>('browser_events_subscribe', { eventTypes: ['page.changed'] });
}
