import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock MessageBroker BEFORE import (matches CacheServiceProxy.test.ts pattern)
vi.mock('../ipc/MessageBroker', () => {
  return {
    messageBroker: {
      invoke: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    },
  };
});

import { BrowserServiceProxy } from './BrowserServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';

describe('BrowserServiceProxy', () => {
  let proxy: BrowserServiceProxy;
  let mockBroker: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBroker = messageBroker;
    proxy = new BrowserServiceProxy();
  });

  it('listAvailableBrowsers invokes browser:listAvailableBrowsers', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce([]);
    await proxy.listAvailableBrowsers();
    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'browser:listAvailableBrowsers',
      {},
      undefined,
      5000,
    );
  });

  it('isCompanionInstalled invokes browser:isCompanionInstalled with family', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(false);
    await proxy.isCompanionInstalled('firefox');
    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'browser:isCompanionInstalled',
      { family: 'firefox' },
      undefined,
      5000,
    );
  });

  it('listBookmarks forwards filter', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce([]);
    await proxy.listBookmarks({ query: 'doc' });
    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'browser:listBookmarks',
      { filter: { query: 'doc' } },
      undefined,
      5000,
    );
  });

  it('searchHistory forwards query + opts', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce([]);
    await proxy.searchHistory('rust', { limit: 10 });
    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'browser:searchHistory',
      { query: 'rust', opts: { limit: 10 } },
      undefined,
      5000,
    );
  });
});

describe('BrowserServiceProxy — bridge methods', () => {
  let proxy: BrowserServiceProxy;
  let mockBroker: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBroker = messageBroker;
    proxy = new BrowserServiceProxy();
  });

  it('listTabs invokes browser:listTabs', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce([]);
    await proxy.listTabs({ query: 'react' });
    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'browser:listTabs',
      { filter: { query: 'react' } },
      undefined,
      5000,
    );
  });

  it('activateTab invokes browser:activateTab', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(undefined);
    await proxy.activateTab('t1');
    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'browser:activateTab',
      { tabId: 't1' },
      undefined,
      5000,
    );
  });

  it('openUrl invokes browser:openUrl with target', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(undefined);
    await proxy.openUrl('https://x', { newWindow: true });
    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'browser:openUrl',
      { url: 'https://x', target: { newWindow: true } },
      undefined,
      5000,
    );
  });

  it('onTabsChanged registers on the broker and off cleans up', async () => {
    const handler = vi.fn();
    const off = proxy.onTabsChanged(handler);
    expect(mockBroker.on).toHaveBeenCalledWith('browser:tabs-changed', expect.any(Function));
    await off();
    expect(mockBroker.off).toHaveBeenCalledWith('browser:tabs-changed', expect.any(Function));
  });
});
