import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock MessageBroker BEFORE import
vi.mock('../ipc/MessageBroker', () => {
  return {
    messageBroker: {
      invoke: vi.fn(),
    },
  };
});

import { SearchServiceProxy } from './SearchServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';

describe('SearchServiceProxy', () => {
  let proxy: SearchServiceProxy;
  let mockBroker: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBroker = messageBroker;
    proxy = new SearchServiceProxy();
  });

  it('rank() calls broker.invoke with the named-key payload the host expects', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(['a']);

    const items = [{ id: 'a', title: 'Apple' }, { id: 'b', title: 'Banana' }];
    const result = await proxy.rank('app', items);

    expect(mockBroker.invoke).toHaveBeenCalledWith('search:rank', {
      query: 'app',
      items,
    });
    expect(result).toEqual(['a']);
  });

  it('rank() returns whatever ordered ids the host resolves with', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(['b', 'a']);
    const result = await proxy.rank('x', [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]);
    expect(result).toEqual(['b', 'a']);
  });
});
