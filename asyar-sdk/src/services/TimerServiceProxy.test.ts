import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ipc/MessageBroker', () => ({
  MessageBroker: {
    getInstance: vi.fn().mockReturnValue({
      invoke: vi.fn(),
    }),
  },
}));

import { TimerServiceProxy } from './TimerServiceProxy';
import { MessageBroker } from '../ipc/MessageBroker';

describe('TimerServiceProxy', () => {
  let proxy: TimerServiceProxy;
  let mockBroker: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBroker = MessageBroker.getInstance();
    proxy = new TimerServiceProxy();
  });

  it('schedule forwards commandId, fireAt and args and returns the timer id', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce('timer-abc');

    const id = await proxy.schedule({
      commandId: 'bell',
      fireAt: 1_700_000_000_000,
      args: { snooze: 300_000, note: 'water the plants' },
    });

    expect(id).toBe('timer-abc');
    expect(mockBroker.invoke).toHaveBeenCalledWith('timers:schedule', {
      opts: {
        commandId: 'bell',
        fireAt: 1_700_000_000_000,
        args: { snooze: 300_000, note: 'water the plants' },
      },
    });
  });

  it('schedule without args still serializes required fields', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce('timer-xyz');
    await proxy.schedule({ commandId: 'bell', fireAt: 2_000 });
    expect(mockBroker.invoke).toHaveBeenCalledWith('timers:schedule', {
      opts: { commandId: 'bell', fireAt: 2_000 },
    });
  });

  it('schedule propagates host-side errors unchanged', async () => {
    vi.mocked(mockBroker.invoke).mockRejectedValueOnce(
      new Error('Validation error: fire_at (100) must be strictly greater than now (2000)'),
    );
    await expect(
      proxy.schedule({ commandId: 'bell', fireAt: 100 }),
    ).rejects.toThrow(/fire_at/);
  });

  it('cancel invokes timers:cancel with the timer id', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(undefined);
    await proxy.cancel('timer-abc');
    expect(mockBroker.invoke).toHaveBeenCalledWith('timers:cancel', {
      timerId: 'timer-abc',
    });
  });

  it('cancel propagates host-side errors', async () => {
    vi.mocked(mockBroker.invoke).mockRejectedValueOnce(new Error('Not found: Timer "xyz" not found'));
    await expect(proxy.cancel('xyz')).rejects.toThrow(/Not found/);
  });

  it('list invokes timers:list and returns descriptors verbatim', async () => {
    const sample = [
      {
        timerId: 't1',
        extensionId: 'my.ext',
        commandId: 'bell',
        args: { snooze: 300_000 },
        fireAt: 1_700_000_000_000,
        createdAt: 1_699_999_000_000,
      },
    ];
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(sample);
    const got = await proxy.list();
    expect(mockBroker.invoke).toHaveBeenCalledWith('timers:list', {});
    expect(got).toEqual(sample);
  });

  it('list returns an empty array unchanged', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce([]);
    expect(await proxy.list()).toEqual([]);
  });
});
