import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock MessageBroker BEFORE import (matches CacheServiceProxy.test.ts pattern)
vi.mock('../ipc/MessageBroker', () => {
  return {
    messageBroker: {
      invoke: vi.fn(),
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
