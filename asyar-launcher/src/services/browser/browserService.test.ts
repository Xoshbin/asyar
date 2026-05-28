import { describe, expect, it, vi, beforeEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { browserService } from './browserService';
import type { Bookmark, BrowserId, HistoryEntry } from 'asyar-sdk/contracts';

beforeEach(() => invokeMock.mockReset());

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
