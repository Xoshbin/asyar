import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock MessageBroker BEFORE import.
vi.mock('../ipc/MessageBroker', () => {
  return {
    messageBroker: {
        invoke: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
    },
  };
});

import { ApplicationServiceProxy } from './ApplicationService';
import { messageBroker } from '../ipc/MessageBroker';

function getPushHandler(mockOn: ReturnType<typeof vi.fn>): (payload: unknown) => void {
  const call = mockOn.mock.calls.find((c) => c[0] === 'asyar:event:app-event:push');
  if (!call) throw new Error('push listener not registered');
  return call[1] as (payload: unknown) => void;
}

describe('ApplicationServiceProxy (query surface)', () => {
  let proxy: ApplicationServiceProxy;
  let mockBroker: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBroker = messageBroker;
    mockBroker.invoke.mockReset();
    mockBroker.on.mockReset();
    mockBroker.off.mockReset();
    proxy = new ApplicationServiceProxy();
  });

  it('getFrontmostApplication() calls broker with correct type string', async () => {
    const mockApp = { name: 'Safari', bundleId: 'com.apple.Safari', windowTitle: 'Apple' };
    mockBroker.invoke.mockResolvedValueOnce(mockApp);

    const result = await proxy.getFrontmostApplication();

    expect(mockBroker.invoke).toHaveBeenCalledWith('application:getFrontmostApplication');
    expect(result).toEqual(mockApp);
  });

  it('syncApplicationIndex() calls broker with correct type string and payload', async () => {
    const mockResult = { added: 5, removed: 2, total: 100 };
    mockBroker.invoke.mockResolvedValueOnce(mockResult);

    const result = await proxy.syncApplicationIndex(['/extra/path']);

    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'application:syncApplicationIndex',
      { extraPaths: ['/extra/path'] },
    );
    expect(result).toEqual(mockResult);
  });

  it('syncApplicationIndex() passes undefined extraPaths when not provided', async () => {
    mockBroker.invoke.mockResolvedValueOnce({ added: 0, removed: 0, total: 50 });

    await proxy.syncApplicationIndex();

    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'application:syncApplicationIndex',
      { extraPaths: undefined },
    );
  });

  it('listApplications() calls broker with correct type string and payload', async () => {
    const mockApps = [{ name: 'Safari', path: '/Applications/Safari.app' }];
    mockBroker.invoke.mockResolvedValueOnce(mockApps);

    const result = await proxy.listApplications(['/custom/path']);

    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'application:listApplications',
      { extraPaths: ['/custom/path'] },
    );
    expect(result).toEqual(mockApps);
  });

  it('listApplications() passes undefined extraPaths when not provided', async () => {
    mockBroker.invoke.mockResolvedValueOnce([]);

    await proxy.listApplications();

    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'application:listApplications',
      { extraPaths: undefined },
    );
  });

  it('type strings do NOT include asyar:service: prefix (MessageBroker adds asyar:api:)', async () => {
    mockBroker.invoke.mockResolvedValue({});

    await proxy.getFrontmostApplication();
    await proxy.syncApplicationIndex();
    await proxy.listApplications();

    const calls = mockBroker.invoke.mock.calls;
    for (const [typeString] of calls) {
      expect(typeString).not.toContain('asyar:');
    }
  });

  it('isRunning() calls broker on application namespace with bundleId', async () => {
    mockBroker.invoke.mockResolvedValueOnce(true);

    const result = await proxy.isRunning('com.apple.Safari');

    expect(mockBroker.invoke).toHaveBeenCalledWith('application:isRunning', {
      bundleId: 'com.apple.Safari',
    });
    expect(result).toBe(true);
  });

  it('isRunning() forwards a false result unchanged', async () => {
    mockBroker.invoke.mockResolvedValueOnce(false);
    const result = await proxy.isRunning('com.nope.NotHere');
    expect(result).toBe(false);
  });
});

describe('ApplicationServiceProxy (push-event surface)', () => {
  let proxy: ApplicationServiceProxy;
  let mockInvoke: ReturnType<typeof vi.fn>;
  let mockOn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    const broker = messageBroker as unknown as {
      invoke: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
      off: ReturnType<typeof vi.fn>;
    };
    mockInvoke = broker.invoke;
    mockOn = broker.on;
    mockInvoke.mockReset();
    mockOn.mockReset();
    broker.off.mockReset();
    proxy = new ApplicationServiceProxy();
  });

  it('first onApplicationLaunched listener triggers exactly one subscribe RPC on appEvents namespace', async () => {
    mockInvoke.mockResolvedValueOnce('sub-1');
    proxy.onApplicationLaunched(() => {});
    await Promise.resolve();
    await Promise.resolve();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('appEvents:subscribe', {
      eventTypes: ['launched'],
    });
  });

  it('second onApplicationLaunched listener does NOT cause a second subscribe RPC', async () => {
    mockInvoke.mockResolvedValueOnce('sub-1');
    proxy.onApplicationLaunched(() => {});
    await Promise.resolve();
    await Promise.resolve();
    proxy.onApplicationLaunched(() => {});
    await Promise.resolve();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('disposing all listeners fires unsubscribe exactly once on appEvents namespace', async () => {
    mockInvoke.mockResolvedValueOnce('sub-1').mockResolvedValueOnce(undefined);
    const d1 = proxy.onApplicationLaunched(() => {});
    const d2 = proxy.onApplicationLaunched(() => {});
    await Promise.resolve();
    await Promise.resolve();
    d1();
    d2();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke).toHaveBeenLastCalledWith('appEvents:unsubscribe', {
      subscriptionId: 'sub-1',
    });
  });

  it('incoming push event dispatches to launched callbacks only', async () => {
    mockInvoke.mockResolvedValue('sub-1');
    const launched = vi.fn();
    const terminated = vi.fn();
    proxy.onApplicationLaunched(launched);
    proxy.onApplicationTerminated(terminated);
    await Promise.resolve();
    await Promise.resolve();

    getPushHandler(mockOn)({
      type: 'launched',
      pid: 42,
      bundleId: 'com.apple.Safari',
      name: 'Safari',
      path: '/Applications/Safari.app',
    });

    expect(launched).toHaveBeenCalledTimes(1);
    expect(launched).toHaveBeenCalledWith({
      type: 'launched',
      pid: 42,
      bundleId: 'com.apple.Safari',
      name: 'Safari',
      path: '/Applications/Safari.app',
    });
    expect(terminated).not.toHaveBeenCalled();
  });

  it('terminated event routes to terminated callback with pid + name', async () => {
    mockInvoke.mockResolvedValue('sub-1');
    const cb = vi.fn();
    proxy.onApplicationTerminated(cb);
    await Promise.resolve();
    await Promise.resolve();

    getPushHandler(mockOn)({
      type: 'terminated',
      pid: 99,
      bundleId: 'com.example.foo',
      name: 'Foo',
    });

    expect(cb).toHaveBeenCalledWith({
      type: 'terminated',
      pid: 99,
      bundleId: 'com.example.foo',
      name: 'Foo',
    });
  });

  it('frontmost-changed event routes only to frontmost callback', async () => {
    mockInvoke.mockResolvedValue('sub-1');
    const launched = vi.fn();
    const frontmost = vi.fn();
    proxy.onApplicationLaunched(launched);
    proxy.onFrontmostApplicationChanged(frontmost);
    await Promise.resolve();
    await Promise.resolve();

    getPushHandler(mockOn)({
      type: 'frontmost-changed',
      pid: 7,
      name: 'Ex',
    });

    expect(frontmost).toHaveBeenCalledTimes(1);
    expect(launched).not.toHaveBeenCalled();
  });

  it('disposer is idempotent — calling twice does not double-unsubscribe', async () => {
    mockInvoke.mockResolvedValueOnce('sub-1').mockResolvedValueOnce(undefined);
    const d = proxy.onApplicationLaunched(() => {});
    await Promise.resolve();
    await Promise.resolve();
    d();
    d();
    await Promise.resolve();
    await Promise.resolve();
    // 1 subscribe + 1 unsubscribe = 2; second dispose is no-op.
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('re-subscribing after full dispose issues a fresh subscribe RPC', async () => {
    mockInvoke
      .mockResolvedValueOnce('sub-1')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('sub-2');
    const d1 = proxy.onApplicationLaunched(() => {});
    await Promise.resolve();
    await Promise.resolve();
    d1();
    await Promise.resolve();
    await Promise.resolve();
    proxy.onApplicationLaunched(() => {});
    await Promise.resolve();
    await Promise.resolve();
    expect(mockInvoke).toHaveBeenCalledTimes(3);
    expect(mockInvoke.mock.calls[2][0]).toBe('appEvents:subscribe');
  });

  it('different event kinds get independent subscriptions', async () => {
    mockInvoke
      .mockResolvedValueOnce('sub-l')
      .mockResolvedValueOnce('sub-t')
      .mockResolvedValueOnce('sub-f');
    proxy.onApplicationLaunched(() => {});
    proxy.onApplicationTerminated(() => {});
    proxy.onFrontmostApplicationChanged(() => {});
    await Promise.resolve();
    await Promise.resolve();
    expect(mockInvoke).toHaveBeenCalledTimes(3);
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'appEvents:subscribe', {
      eventTypes: ['launched'],
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'appEvents:subscribe', {
      eventTypes: ['terminated'],
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(3, 'appEvents:subscribe', {
      eventTypes: ['frontmost-changed'],
    });
  });

  it('a throwing callback does not prevent other callbacks for the same kind', async () => {
    mockInvoke.mockResolvedValue('sub-1');
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    proxy.onApplicationLaunched(bad);
    proxy.onApplicationLaunched(good);
    await Promise.resolve();
    await Promise.resolve();

    getPushHandler(mockOn)({
      type: 'launched',
      pid: 1,
      name: 'X',
    });

    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });
});

function getIndexPushHandler(
  mockOn: ReturnType<typeof vi.fn>,
): (payload: unknown) => void {
  const call = mockOn.mock.calls.find(
    (c) => c[0] === 'asyar:event:application-index:push',
  );
  if (!call) throw new Error('index push listener not registered');
  return call[1] as (payload: unknown) => void;
}

describe('ApplicationServiceProxy (application-index push surface)', () => {
  let proxy: ApplicationServiceProxy;
  let mockInvoke: ReturnType<typeof vi.fn>;
  let mockOn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    const broker = messageBroker as unknown as {
      invoke: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
      off: ReturnType<typeof vi.fn>;
    };
    mockInvoke = broker.invoke;
    mockOn = broker.on;
    mockInvoke.mockReset();
    mockOn.mockReset();
    broker.off.mockReset();
    proxy = new ApplicationServiceProxy();
  });

  it('first onApplicationsChanged listener triggers exactly one subscribe RPC on applicationIndex namespace', async () => {
    mockInvoke.mockResolvedValueOnce('idx-1');
    proxy.onApplicationsChanged(() => {});
    await Promise.resolve();
    await Promise.resolve();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('applicationIndex:subscribe', {
      eventTypes: ['applications-changed'],
    });
  });

  it('second onApplicationsChanged listener does NOT cause a second subscribe RPC', async () => {
    mockInvoke.mockResolvedValueOnce('idx-1');
    proxy.onApplicationsChanged(() => {});
    await Promise.resolve();
    await Promise.resolve();
    proxy.onApplicationsChanged(() => {});
    await Promise.resolve();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('disposing all listeners fires unsubscribe exactly once on applicationIndex namespace', async () => {
    mockInvoke
      .mockResolvedValueOnce('idx-1')
      .mockResolvedValueOnce(undefined);
    const d1 = proxy.onApplicationsChanged(() => {});
    const d2 = proxy.onApplicationsChanged(() => {});
    await Promise.resolve();
    await Promise.resolve();
    d1();
    d2();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke).toHaveBeenLastCalledWith('applicationIndex:unsubscribe', {
      subscriptionId: 'idx-1',
    });
  });

  it('incoming push payload dispatches to all applications-changed listeners', async () => {
    mockInvoke.mockResolvedValue('idx-1');
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    proxy.onApplicationsChanged(cb1);
    proxy.onApplicationsChanged(cb2);
    await Promise.resolve();
    await Promise.resolve();

    getIndexPushHandler(mockOn)({
      type: 'applications-changed',
      added: 2,
      removed: 0,
      total: 120,
    });

    const expected = {
      type: 'applications-changed',
      added: 2,
      removed: 0,
      total: 120,
    };
    expect(cb1).toHaveBeenCalledWith(expected);
    expect(cb2).toHaveBeenCalledWith(expected);
  });

  it('index push listener is separate from appEvents push listener', async () => {
    // Subscribing to appEvents must not register an index listener and vice
    // versa — they use different iframe push types.
    mockInvoke.mockResolvedValue('sub-x');
    proxy.onApplicationLaunched(() => {});
    proxy.onApplicationsChanged(() => {});
    await Promise.resolve();
    await Promise.resolve();

    const registeredTypes = mockOn.mock.calls.map((c) => c[0]);
    expect(registeredTypes).toContain('asyar:event:app-event:push');
    expect(registeredTypes).toContain('asyar:event:application-index:push');
  });

  it('disposer is idempotent for index subscriptions', async () => {
    mockInvoke
      .mockResolvedValueOnce('idx-1')
      .mockResolvedValueOnce(undefined);
    const d = proxy.onApplicationsChanged(() => {});
    await Promise.resolve();
    await Promise.resolve();
    d();
    d();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('re-subscribing after full dispose issues a fresh subscribe RPC', async () => {
    mockInvoke
      .mockResolvedValueOnce('idx-1')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('idx-2');
    const d1 = proxy.onApplicationsChanged(() => {});
    await Promise.resolve();
    await Promise.resolve();
    d1();
    await Promise.resolve();
    await Promise.resolve();
    proxy.onApplicationsChanged(() => {});
    await Promise.resolve();
    await Promise.resolve();
    expect(mockInvoke).toHaveBeenCalledTimes(3);
    expect(mockInvoke.mock.calls[2][0]).toBe('applicationIndex:subscribe');
  });

  it('a throwing callback does not prevent other callbacks for the same kind', async () => {
    mockInvoke.mockResolvedValue('idx-1');
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    proxy.onApplicationsChanged(bad);
    proxy.onApplicationsChanged(good);
    await Promise.resolve();
    await Promise.resolve();

    getIndexPushHandler(mockOn)({
      type: 'applications-changed',
      added: 1,
      removed: 0,
      total: 1,
    });

    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('applicationIndex wire string has no asyar:api: prefix', async () => {
    mockInvoke.mockResolvedValueOnce('idx-1');
    proxy.onApplicationsChanged(() => {});
    await Promise.resolve();
    await Promise.resolve();
    const [[wireType]] = mockInvoke.mock.calls;
    expect(wireType).toBe('applicationIndex:subscribe');
    expect(wireType).not.toContain('asyar:');
  });
});
