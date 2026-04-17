import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ipc/MessageBroker', () => ({
  MessageBroker: {
    getInstance: vi.fn().mockReturnValue({
      invoke: vi.fn(),
    }),
  },
}));

import { PowerServiceProxy } from './PowerServiceProxy';
import { MessageBroker } from '../ipc/MessageBroker';

describe('PowerServiceProxy', () => {
  let proxy: PowerServiceProxy;
  let mockBroker: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBroker = MessageBroker.getInstance();
    proxy = new PowerServiceProxy();
  });

  it('keepAwake invokes power:keepAwake with the full payload and returns the token', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce('token-123');

    const token = await proxy.keepAwake({
      system: true,
      display: true,
      disk: false,
      reason: 'Transcribing audio',
    });

    expect(token).toBe('token-123');
    expect(mockBroker.invoke).toHaveBeenCalledWith('power:keepAwake', {
      options: {
        system: true,
        display: true,
        disk: false,
        reason: 'Transcribing audio',
      },
    });
  });

  it('keepAwake with only reason still serializes that field', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce('token-42');

    await proxy.keepAwake({ reason: 'default' });

    expect(mockBroker.invoke).toHaveBeenCalledWith('power:keepAwake', {
      options: { reason: 'default' },
    });
  });

  it('release invokes power:release with the token', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(undefined);

    await proxy.release('tok');

    expect(mockBroker.invoke).toHaveBeenCalledWith('power:release', { token: 'tok' });
  });

  it('list invokes power:list and returns the array', async () => {
    const sample = [
      {
        token: 't1',
        options: { system: true, display: false, disk: false },
        reason: 'x',
        createdAt: 1,
      },
    ];
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(sample);

    const list = await proxy.list();

    expect(mockBroker.invoke).toHaveBeenCalledWith('power:list', {});
    expect(list).toEqual(sample);
  });
});
