import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: {
      invoke: vi.fn(),
  },
}));

import { ProcessServiceProxy } from './ProcessServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';

describe('ProcessServiceProxy', () => {
  let proxy: ProcessServiceProxy;
  let mockBroker: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBroker = messageBroker;
    proxy = new ProcessServiceProxy();
  });

  it('list invokes process:list with query + sortBy', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce([]);

    const groups = await proxy.list({ query: 'chrome', sortBy: 'cpu' });

    expect(groups).toEqual([]);
    expect(mockBroker.invoke).toHaveBeenCalledWith('process:list', {
      query: 'chrome',
      sortBy: 'cpu',
    });
  });

  it('list omits query when not provided', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce([]);

    await proxy.list({ sortBy: 'name' });

    expect(mockBroker.invoke).toHaveBeenCalledWith('process:list', {
      query: undefined,
      sortBy: 'name',
    });
  });

  it('kill invokes process:kill with pids/force/confirmedProtected', async () => {
    const result = { killed: [1], failed: [] };
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(result);

    const res = await proxy.kill({ pids: [1, 2], force: true, confirmedProtected: false });

    expect(res).toEqual(result);
    expect(mockBroker.invoke).toHaveBeenCalledWith('process:kill', {
      pids: [1, 2],
      force: true,
      confirmedProtected: false,
    });
  });

  it('kill defaults confirmedProtected to false when omitted', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce({ killed: [], failed: [] });

    await proxy.kill({ pids: [5], force: false });

    expect(mockBroker.invoke).toHaveBeenCalledWith('process:kill', {
      pids: [5],
      force: false,
      confirmedProtected: false,
    });
  });
});
