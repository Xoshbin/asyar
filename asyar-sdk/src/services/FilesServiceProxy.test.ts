import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock MessageBroker BEFORE import
vi.mock('../ipc/MessageBroker', () => {
  return {
    messageBroker: {
      invoke: vi.fn(),
    },
  };
});

import { FilesServiceProxy } from './FilesServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';

describe('FilesServiceProxy', () => {
  let proxy: FilesServiceProxy;
  let mockBroker: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBroker = messageBroker;
    proxy = new FilesServiceProxy();
  });

  it('search() calls broker.invoke with query and default empty opts', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce([]);
    const result = await proxy.search('report');
    expect(mockBroker.invoke).toHaveBeenCalledWith('files:search', {
      query: 'report',
      opts: {},
    });
    expect(result).toEqual([]);
  });

  it('search() forwards typeFilter and limit opts', async () => {
    const hits = [{ fileId: 'abc', name: 'a.pdf' }];
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(hits);
    const result = await proxy.search('a', { typeFilter: 'document', limit: 10 });
    expect(mockBroker.invoke).toHaveBeenCalledWith('files:search', {
      query: 'a',
      opts: { typeFilter: 'document', limit: 10 },
    });
    expect(result).toEqual(hits);
  });

  it('status() calls broker.invoke with files:status', async () => {
    const status = {
      state: 'ready',
      entryCount: 10,
      lastScanMs: 5,
      snapshotLoaded: true,
      capReached: false,
    };
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(status);
    const result = await proxy.status();
    expect(mockBroker.invoke).toHaveBeenCalledWith('files:status', {});
    expect(result).toEqual(status);
  });
});
