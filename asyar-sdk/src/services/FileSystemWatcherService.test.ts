import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock MessageBroker BEFORE import so the proxy sees the mock.
vi.mock('../ipc/MessageBroker', () => {
  return {
    messageBroker: {
      invoke: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    },
  };
});

import { FileSystemWatcherServiceProxy } from './FileSystemWatcherService';
import { messageBroker } from '../ipc/MessageBroker';

function getPushHandler(mockOn: ReturnType<typeof vi.fn>): (payload: unknown) => void {
  const call = mockOn.mock.calls.find((c) => c[0] === 'asyar:event:fs-watch:push');
  if (!call) throw new Error('push listener not registered');
  return call[1] as (payload: unknown) => void;
}

describe('FileSystemWatcherServiceProxy', () => {
  let proxy: FileSystemWatcherServiceProxy;
  let mockBroker: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBroker = messageBroker;
    mockBroker.invoke.mockReset();
    mockBroker.on.mockReset();
    proxy = new FileSystemWatcherServiceProxy();
  });

  it('first watch() issues fsWatcher:create with the right payload', async () => {
    mockBroker.invoke.mockResolvedValueOnce('h1');
    await proxy.watch(['/tmp/smoke'], { debounceMs: 300 });
    expect(mockBroker.invoke).toHaveBeenCalledWith('fsWatcher:create', {
      paths: ['/tmp/smoke'],
      opts: { debounceMs: 300 },
    });
  });

  it('watch() installs the push listener exactly once across multiple calls', async () => {
    mockBroker.invoke.mockResolvedValue('h1');
    await proxy.watch(['/tmp/a']);
    await proxy.watch(['/tmp/b']);
    const pushInstalls = mockBroker.on.mock.calls.filter(
      (c: unknown[]) => c[0] === 'asyar:event:fs-watch:push',
    );
    expect(pushInstalls.length).toBe(1);
  });

  it('routes push events to the right handle callback', async () => {
    mockBroker.invoke.mockResolvedValueOnce('h1');
    const h = await proxy.watch(['/tmp/smoke']);
    const cb = vi.fn();
    h.onChange(cb);
    const push = getPushHandler(mockBroker.on);
    push({
      handleId: 'h1',
      change: { type: 'change', paths: ['/tmp/smoke'] },
    });
    expect(cb).toHaveBeenCalledWith({ type: 'change', paths: ['/tmp/smoke'] });
  });

  it('does not deliver events for a different handleId', async () => {
    mockBroker.invoke.mockResolvedValueOnce('h1');
    const h = await proxy.watch(['/tmp/a']);
    const cb = vi.fn();
    h.onChange(cb);
    const push = getPushHandler(mockBroker.on);
    push({
      handleId: 'h2',
      change: { type: 'change', paths: ['/tmp/b'] },
    });
    expect(cb).not.toHaveBeenCalled();
  });

  it('two concurrent handles do not cross-deliver events', async () => {
    mockBroker.invoke
      .mockResolvedValueOnce('h1')
      .mockResolvedValueOnce('h2');
    const ha = await proxy.watch(['/tmp/a']);
    const hb = await proxy.watch(['/tmp/b']);
    const cba = vi.fn();
    const cbb = vi.fn();
    ha.onChange(cba);
    hb.onChange(cbb);
    const push = getPushHandler(mockBroker.on);
    push({
      handleId: 'h1',
      change: { type: 'change', paths: ['/tmp/a'] },
    });
    expect(cba).toHaveBeenCalledTimes(1);
    expect(cbb).not.toHaveBeenCalled();
  });

  it('onChange returns an unsubscribe that stops subsequent delivery', async () => {
    mockBroker.invoke.mockResolvedValueOnce('h1');
    const h = await proxy.watch(['/tmp/a']);
    const cb = vi.fn();
    const unsubscribe = h.onChange(cb);
    const push = getPushHandler(mockBroker.on);
    push({ handleId: 'h1', change: { type: 'change', paths: ['/tmp/a'] } });
    expect(cb).toHaveBeenCalledTimes(1);
    unsubscribe();
    push({ handleId: 'h1', change: { type: 'change', paths: ['/tmp/a'] } });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('dispose() issues fsWatcher:dispose and stops subsequent delivery', async () => {
    mockBroker.invoke
      .mockResolvedValueOnce('h1')
      .mockResolvedValueOnce(undefined);
    const h = await proxy.watch(['/tmp/a']);
    const cb = vi.fn();
    h.onChange(cb);
    await h.dispose();
    expect(mockBroker.invoke).toHaveBeenLastCalledWith('fsWatcher:dispose', {
      handleId: 'h1',
    });
    const push = getPushHandler(mockBroker.on);
    push({ handleId: 'h1', change: { type: 'change', paths: ['/tmp/a'] } });
    expect(cb).not.toHaveBeenCalled();
  });

  it('dispose() is idempotent — second call is a no-op', async () => {
    mockBroker.invoke
      .mockResolvedValueOnce('h1')
      .mockResolvedValueOnce(undefined);
    const h = await proxy.watch(['/tmp/a']);
    await h.dispose();
    await h.dispose(); // must not throw and must not re-invoke
    // One create + one dispose = 2 invokes total.
    expect(mockBroker.invoke).toHaveBeenCalledTimes(2);
  });

  it('ignores malformed push payloads without throwing', async () => {
    mockBroker.invoke.mockResolvedValueOnce('h1');
    const h = await proxy.watch(['/tmp/a']);
    const cb = vi.fn();
    h.onChange(cb);
    const push = getPushHandler(mockBroker.on);
    push(undefined);
    push({});
    push({ handleId: 'h1' }); // missing change
    expect(cb).not.toHaveBeenCalled();
  });

  it('one failing callback does not block the others', async () => {
    mockBroker.invoke.mockResolvedValueOnce('h1');
    const h = await proxy.watch(['/tmp/a']);
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    h.onChange(bad);
    h.onChange(good);
    const push = getPushHandler(mockBroker.on);
    push({ handleId: 'h1', change: { type: 'change', paths: ['/tmp/a'] } });
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });
});
