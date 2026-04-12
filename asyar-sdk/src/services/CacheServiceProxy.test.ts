import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock MessageBroker BEFORE import
vi.mock('../ipc/MessageBroker', () => {
  return {
    MessageBroker: {
      getInstance: vi.fn().mockReturnValue({
        invoke: vi.fn(),
      }),
    },
  };
});

import { CacheServiceProxy } from './CacheServiceProxy';
import { MessageBroker } from '../ipc/MessageBroker';

describe('CacheServiceProxy', () => {
  let proxy: CacheServiceProxy;
  let mockBroker: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBroker = MessageBroker.getInstance();
    proxy = new CacheServiceProxy();
  });

  it('get() calls broker.invoke with correct params', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce('cached-value');

    const result = await proxy.get('my-key');

    expect(mockBroker.invoke).toHaveBeenCalledWith('cache:get', {
      key: 'my-key',
    });
    expect(result).toBe('cached-value');
  });

  it('set() serializes Date to unix timestamp', async () => {
    const futureDate = new Date('2030-01-01T00:00:00Z');
    const expectedTimestamp = Math.floor(futureDate.getTime() / 1000);

    await proxy.set('my-key', 'my-value', { expirationDate: futureDate });

    expect(mockBroker.invoke).toHaveBeenCalledWith('cache:set', {
      key: 'my-key',
      value: 'my-value',
      expiresAt: expectedTimestamp,
    });
  });

  it('remove() returns boolean from host', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(true);
    const result = await proxy.remove('k1');
    expect(result).toBe(true);
  });

  it('clear() calls broker.invoke', async () => {
    await proxy.clear();
    expect(mockBroker.invoke).toHaveBeenCalledWith('cache:clear', {});
  });
});
