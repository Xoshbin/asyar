import { describe, expect, it, vi, beforeEach } from 'vitest';

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

import { browserService } from './browserService';
import type { Bookmark, BrowserId, HistoryEntry } from 'asyar-sdk/contracts';

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
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

  it('onTabsChanged registers a Tauri event listener and returns an unsubscribe', async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);
    const handler = vi.fn();
    const off = browserService.onTabsChanged(handler);
    expect(listenMock).toHaveBeenCalledWith('browser:tabs-changed', expect.any(Function));
    await off();
    expect(unlisten).toHaveBeenCalled();
  });
});
