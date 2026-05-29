import { describe, expect, it, vi, beforeEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { browserService } from './browserService';
import type { Bookmark, BrowserId, HistoryEntry } from 'asyar-sdk/contracts';

beforeEach(() => {
  invokeMock.mockReset();
});

describe('browserService', () => {
  it('listAvailableBrowsers calls the right command', async () => {
    const fake: BrowserId[] = [
      { family: 'chromium', variant: 'chrome', profileId: 'Default' },
    ];
    invokeMock.mockResolvedValue(fake);
    const result = await browserService.listAvailableBrowsers();
    expect(invokeMock).toHaveBeenCalledWith('browser_list_available_browsers');
    expect(result).toEqual(fake);
  });

  it('isCompanionInstalled passes family argument', async () => {
    invokeMock.mockResolvedValue(false);
    const result = await browserService.isCompanionInstalled('chromium');
    expect(invokeMock).toHaveBeenCalledWith('browser_is_companion_installed', { family: 'chromium' });
    expect(result).toBe(false);
  });

  it('listBookmarks passes filter args', async () => {
    const fake: Bookmark[] = [];
    invokeMock.mockResolvedValue(fake);
    await browserService.listBookmarks({ query: 'foo' });
    expect(invokeMock).toHaveBeenCalledWith('browser_list_bookmarks', {
      browser: undefined,
      query: 'foo',
    });
  });

  it('listBookmarks with no filter passes undefined args', async () => {
    invokeMock.mockResolvedValue([]);
    await browserService.listBookmarks();
    expect(invokeMock).toHaveBeenCalledWith('browser_list_bookmarks', {
      browser: undefined,
      query: undefined,
    });
  });

  it('searchHistory forwards all options', async () => {
    const fake: HistoryEntry[] = [];
    invokeMock.mockResolvedValue(fake);
    await browserService.searchHistory('react', { limit: 50, sinceMs: 1000 });
    expect(invokeMock).toHaveBeenCalledWith('browser_search_history', {
      query: 'react',
      limit: 50,
      sinceMs: 1000,
    });
  });
});

describe('browserService — live bridge', () => {
  it('listTabs forwards browser + query', async () => {
    invokeMock.mockResolvedValue([]);
    await browserService.listTabs({ query: 'react' });
    expect(invokeMock).toHaveBeenCalledWith('browser_list_tabs', {
      browser: undefined,
      query: 'react',
    });
  });

  it('getActiveTab forwards browser', async () => {
    invokeMock.mockResolvedValue(null);
    await browserService.getActiveTab();
    expect(invokeMock).toHaveBeenCalledWith('browser_get_active_tab', { browser: undefined });
  });

  it('activateTab passes tab_id', async () => {
    invokeMock.mockResolvedValue(undefined);
    await browserService.activateTab('tab-42');
    expect(invokeMock).toHaveBeenCalledWith('browser_activate_tab', { tabId: 'tab-42' });
  });

  it('closeTab passes tab_id', async () => {
    invokeMock.mockResolvedValue(undefined);
    await browserService.closeTab('tab-42');
    expect(invokeMock).toHaveBeenCalledWith('browser_close_tab', { tabId: 'tab-42' });
  });

  it('openUrl forwards url + target', async () => {
    invokeMock.mockResolvedValue(undefined);
    await browserService.openUrl('https://x', { newWindow: true });
    expect(invokeMock).toHaveBeenCalledWith('browser_open_url', {
      url: 'https://x',
      target: { newWindow: true },
    });
  });

  it('listPairedBrowsers calls the command', async () => {
    invokeMock.mockResolvedValue([]);
    await browserService.listPairedBrowsers();
    expect(invokeMock).toHaveBeenCalledWith('browser_list_paired_browsers');
  });

  it('getCurrentPage forwards browser', async () => {
    invokeMock.mockResolvedValue(null);
    await browserService.getCurrentPage();
    expect(invokeMock).toHaveBeenCalledWith('browser_get_current_page', { browser: undefined });
  });

  it('queryPage forwards tabId, selector, and attrs', async () => {
    invokeMock.mockResolvedValue([]);
    await browserService.queryPage('t1', 'a', ['href']);
    expect(invokeMock).toHaveBeenCalledWith('browser_query_page', { tabId: 't1', selector: 'a', attrs: ['href'] });
  });

  it('actOnPage forwards tabId and action', async () => {
    invokeMock.mockResolvedValue(undefined);
    await browserService.actOnPage('t1', { kind: 'reload' });
    expect(invokeMock).toHaveBeenCalledWith('browser_act_on_page', { tabId: 't1', action: { kind: 'reload' } });
  });
});

describe('browserService — command-bar additions', () => {
  it('searchWeb calls browser_search_web with text + browser undefined', async () => {
    invokeMock.mockResolvedValue(undefined);
    await browserService.searchWeb('q');
    expect(invokeMock).toHaveBeenCalledWith('browser_search_web', { text: 'q', browser: undefined });
  });

  it('searchWeb calls browser_search_web with text + specific browser', async () => {
    invokeMock.mockResolvedValue(undefined);
    const someBrowser = { family: 'chromium' as const, variant: 'chrome', profileId: 'Default' };
    await browserService.searchWeb('q', someBrowser);
    expect(invokeMock).toHaveBeenCalledWith('browser_search_web', { text: 'q', browser: someBrowser });
  });

  it('getMostRecentActiveBrowser calls browser_get_most_recent_active_browser', async () => {
    invokeMock.mockResolvedValue(null);
    await browserService.getMostRecentActiveBrowser();
    expect(invokeMock).toHaveBeenCalledWith('browser_get_most_recent_active_browser');
  });
});

describe('browserService — subscribe per-kind (hard-coded eventTypes)', () => {
  it('subscribeTabsChanged invokes browser_events_subscribe with hard-coded tabs.changed', async () => {
    invokeMock.mockResolvedValue('sub-1');
    const id = await browserService.subscribeTabsChanged();
    expect(invokeMock).toHaveBeenCalledWith('browser_events_subscribe', {
      eventTypes: ['tabs.changed'],
    });
    expect(id).toBe('sub-1');
  });

  it('subscribePageChanged invokes browser_events_subscribe with hard-coded page.changed', async () => {
    invokeMock.mockResolvedValue('sub-2');
    await browserService.subscribePageChanged();
    expect(invokeMock).toHaveBeenCalledWith('browser_events_subscribe', {
      eventTypes: ['page.changed'],
    });
  });

  it('subscribeTabsChanged takes NO parameters (security boundary — wire payload cannot override eventTypes)', () => {
    // TypeScript-level check: the signature must be `(): Promise<string>` with arity 0.
    // If someone adds an `eventTypes?: string[]` param, this assertion-by-shape fails to compile.
    expect(browserService.subscribeTabsChanged.length).toBe(0);
    expect(browserService.subscribePageChanged.length).toBe(0);
  });

  it('unsubscribeTabsChanged invokes browser_events_unsubscribe', async () => {
    invokeMock.mockResolvedValue(undefined);
    await browserService.unsubscribeTabsChanged('sub-1');
    expect(invokeMock).toHaveBeenCalledWith('browser_events_unsubscribe', { subscriptionId: 'sub-1' });
  });

  it('unsubscribePageChanged invokes browser_events_unsubscribe', async () => {
    invokeMock.mockResolvedValue(undefined);
    await browserService.unsubscribePageChanged('sub-2');
    expect(invokeMock).toHaveBeenCalledWith('browser_events_unsubscribe', { subscriptionId: 'sub-2' });
  });
});
