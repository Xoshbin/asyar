import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ipc/MessageBroker', () => ({
  MessageBroker: {
    getInstance: vi.fn().mockReturnValue({
      invoke: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    }),
  },
}));

import { SystemEventsServiceProxy } from './SystemEventsServiceProxy';
import { MessageBroker } from '../ipc/MessageBroker';

let mockInvoke: ReturnType<typeof vi.fn>;
let mockOn: ReturnType<typeof vi.fn>;

function getPushHandler(): (payload: unknown) => void {
  const call = mockOn.mock.calls.find(
    (c) => c[0] === 'asyar:event:system-event:push',
  );
  if (!call) throw new Error('push listener not registered');
  return call[1] as (payload: unknown) => void;
}

describe('SystemEventsServiceProxy', () => {
  let proxy: SystemEventsServiceProxy;

  beforeEach(() => {
    vi.clearAllMocks();
    const broker = MessageBroker.getInstance() as unknown as {
      invoke: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
      off: ReturnType<typeof vi.fn>;
    };
    mockInvoke = broker.invoke;
    mockOn = broker.on;
    mockInvoke.mockReset();
    mockOn.mockReset();
    broker.off.mockReset();
    proxy = new SystemEventsServiceProxy();
  });

  it('first onSystemWake listener triggers exactly one subscribe RPC', async () => {
    mockInvoke.mockResolvedValueOnce('sub-1');
    proxy.onSystemWake(() => {});
    // let the invoke promise settle
    await Promise.resolve();
    await Promise.resolve();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('systemEvents:subscribe', {
      eventTypes: ['wake'],
    });
  });

  it('second onSystemWake listener does NOT cause a second subscribe RPC', async () => {
    mockInvoke.mockResolvedValueOnce('sub-1');
    proxy.onSystemWake(() => {});
    await Promise.resolve();
    await Promise.resolve();
    proxy.onSystemWake(() => {});
    await Promise.resolve();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('disposing all listeners fires unsubscribe exactly once', async () => {
    mockInvoke.mockResolvedValueOnce('sub-1').mockResolvedValueOnce(undefined);
    const d1 = proxy.onSystemWake(() => {});
    const d2 = proxy.onSystemWake(() => {});
    await Promise.resolve();
    await Promise.resolve();
    d1();
    d2();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke).toHaveBeenLastCalledWith('systemEvents:unsubscribe', {
      subscriptionId: 'sub-1',
    });
  });

  it('incoming push event dispatches to wake callbacks only', async () => {
    mockInvoke.mockResolvedValue('sub-1');
    const wakeCb = vi.fn();
    const sleepCb = vi.fn();
    proxy.onSystemWake(wakeCb);
    proxy.onSystemSleep(sleepCb);
    await Promise.resolve();
    await Promise.resolve();

    getPushHandler()({ type: 'wake' });

    expect(wakeCb).toHaveBeenCalledTimes(1);
    expect(sleepCb).not.toHaveBeenCalled();
  });

  it('battery event delivers percent to battery callback', async () => {
    mockInvoke.mockResolvedValue('sub-1');
    const cb = vi.fn();
    proxy.onBatteryLevelChange(cb);
    await Promise.resolve();
    await Promise.resolve();

    getPushHandler()({ type: 'battery-level-changed', percent: 42 });

    expect(cb).toHaveBeenCalledWith(42);
  });

  it('power-source event delivers onBattery boolean', async () => {
    mockInvoke.mockResolvedValue('sub-1');
    const cb = vi.fn();
    proxy.onPowerSourceChange(cb);
    await Promise.resolve();
    await Promise.resolve();

    getPushHandler()({ type: 'power-source-changed', onBattery: true });

    expect(cb).toHaveBeenCalledWith(true);
  });

  it('lid-open event dispatches to lid-open callback only', async () => {
    mockInvoke.mockResolvedValue('sub-1');
    const open = vi.fn();
    const close = vi.fn();
    proxy.onLidOpen(open);
    proxy.onLidClose(close);
    await Promise.resolve();
    await Promise.resolve();

    getPushHandler()({ type: 'lid-open' });

    expect(open).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it('disposer is idempotent — calling twice does not double-unsubscribe', async () => {
    mockInvoke.mockResolvedValueOnce('sub-1').mockResolvedValueOnce(undefined);
    const d = proxy.onSystemWake(() => {});
    await Promise.resolve();
    await Promise.resolve();
    d();
    d();
    await Promise.resolve();
    await Promise.resolve();
    // 1 subscribe + 1 unsubscribe = 2 total; second dispose is no-op
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('re-subscribing after full dispose issues a fresh subscribe RPC', async () => {
    mockInvoke
      .mockResolvedValueOnce('sub-1')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('sub-2');
    const d1 = proxy.onSystemWake(() => {});
    await Promise.resolve();
    await Promise.resolve();
    d1();
    await Promise.resolve();
    await Promise.resolve();
    proxy.onSystemWake(() => {});
    await Promise.resolve();
    await Promise.resolve();
    expect(mockInvoke).toHaveBeenCalledTimes(3);
    expect(mockInvoke.mock.calls[2][0]).toBe('systemEvents:subscribe');
  });

  it('different event kinds get independent subscriptions', async () => {
    mockInvoke.mockResolvedValueOnce('sub-wake').mockResolvedValueOnce('sub-sleep');
    proxy.onSystemWake(() => {});
    proxy.onSystemSleep(() => {});
    await Promise.resolve();
    await Promise.resolve();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'systemEvents:subscribe', {
      eventTypes: ['wake'],
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'systemEvents:subscribe', {
      eventTypes: ['sleep'],
    });
  });

  it('a throwing callback does not prevent other callbacks for the same kind', async () => {
    mockInvoke.mockResolvedValue('sub-1');
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    proxy.onSystemWake(bad);
    proxy.onSystemWake(good);
    await Promise.resolve();
    await Promise.resolve();

    getPushHandler()({ type: 'wake' });

    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });
});
