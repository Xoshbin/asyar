/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { messageBroker } from '../ipc/MessageBroker';
import { ExtensionStateProxy, extensionStateProxy } from './ExtensionStateProxy';

describe('ExtensionStateProxy', () => {
  let invokeSpy: ReturnType<typeof vi.spyOn>;
  let onSpy: ReturnType<typeof vi.spyOn>;
  let offSpy: ReturnType<typeof vi.spyOn>;
  let pushHandlers: Map<string, Array<(payload: unknown) => void>>;

  beforeEach(() => {
    invokeSpy = vi.spyOn(messageBroker, 'invoke');
    pushHandlers = new Map();

    onSpy = vi.spyOn(messageBroker, 'on').mockImplementation(((
      event: string,
      handler: (payload: unknown) => void,
    ) => {
      const list = pushHandlers.get(event) ?? [];
      list.push(handler);
      pushHandlers.set(event, list);
    }) as any);

    offSpy = vi.spyOn(messageBroker, 'off').mockImplementation(((
      event: string,
      handler: (payload: unknown) => void,
    ) => {
      const list = pushHandlers.get(event) ?? [];
      pushHandlers.set(
        event,
        list.filter((h) => h !== handler),
      );
    }) as any);
  });

  afterEach(() => {
    invokeSpy.mockRestore();
    onSpy.mockRestore();
    offSpy.mockRestore();
  });

  function deliverPush(event: string, payload: unknown) {
    for (const h of pushHandlers.get(event) ?? []) h(payload);
  }

  // ── get / set wire shape ───────────────────────────────────────────────

  it('get invokes state:get with { key } and forwards the host response', async () => {
    invokeSpy.mockResolvedValueOnce({ secs: 7 });
    const proxy = new ExtensionStateProxy();
    const v = await proxy.get('timer');
    expect(invokeSpy).toHaveBeenCalledWith('state:get', { key: 'timer' });
    expect(v).toEqual({ secs: 7 });
  });

  it('get returns null when host returns null', async () => {
    invokeSpy.mockResolvedValueOnce(null);
    const proxy = new ExtensionStateProxy();
    expect(await proxy.get('missing')).toBeNull();
  });

  it('set invokes state:set with { key, value }', async () => {
    invokeSpy.mockResolvedValueOnce(undefined);
    const proxy = new ExtensionStateProxy();
    await proxy.set('timer', { running: true });
    expect(invokeSpy).toHaveBeenCalledWith('state:set', {
      key: 'timer',
      value: { running: true },
    });
  });

  // ── subscribe / unsubscribe ────────────────────────────────────────────

  it('subscribe issues state:subscribe with { key, role } using auto-detected role', async () => {
    (window as any).__ASYAR_ROLE__ = 'view';
    invokeSpy.mockResolvedValueOnce(42); // returned subscription id
    const proxy = new ExtensionStateProxy();
    const dispose = await proxy.subscribe('timer', () => {});
    expect(invokeSpy).toHaveBeenCalledWith('state:subscribe', {
      key: 'timer',
      role: 'view',
    });
    expect(typeof dispose).toBe('function');
    delete (window as any).__ASYAR_ROLE__;
  });

  it('subscribe handler fires when matching state:changed push arrives', async () => {
    (window as any).__ASYAR_ROLE__ = 'view';
    invokeSpy.mockResolvedValueOnce(1);
    const proxy = new ExtensionStateProxy();
    const handler = vi.fn();
    await proxy.subscribe('timer', handler);

    deliverPush('asyar:event:state:changed:push', {
      extensionId: 'ext.a',
      key: 'timer',
      value: { secs: 5 },
      role: 'view',
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ secs: 5 });
    delete (window as any).__ASYAR_ROLE__;
  });

  it('subscribe handler does NOT fire for events on a different key', async () => {
    (window as any).__ASYAR_ROLE__ = 'view';
    invokeSpy.mockResolvedValueOnce(1);
    const proxy = new ExtensionStateProxy();
    const handler = vi.fn();
    await proxy.subscribe('timer', handler);

    deliverPush('asyar:event:state:changed:push', {
      extensionId: 'ext.a',
      key: 'someOtherKey',
      value: 1,
      role: 'view',
    });
    expect(handler).not.toHaveBeenCalled();
    delete (window as any).__ASYAR_ROLE__;
  });

  it('unsubscribe disposer issues state:unsubscribe and silences future events', async () => {
    (window as any).__ASYAR_ROLE__ = 'view';
    invokeSpy.mockResolvedValueOnce(99); // subscribe → id 99
    const proxy = new ExtensionStateProxy();
    const handler = vi.fn();
    const dispose = await proxy.subscribe('timer', handler);

    invokeSpy.mockResolvedValueOnce(undefined); // unsubscribe call
    await dispose();
    expect(invokeSpy).toHaveBeenLastCalledWith('state:unsubscribe', {
      subscriptionId: 99,
    });

    deliverPush('asyar:event:state:changed:push', {
      extensionId: 'ext.a',
      key: 'timer',
      value: 1,
      role: 'view',
    });
    expect(handler).not.toHaveBeenCalled();
    delete (window as any).__ASYAR_ROLE__;
  });

  // ── pagehide auto-cleanup (view-side contract) ─────────────────────────

  it('view-side: pagehide event fires unsubscribe for every active subscription', async () => {
    (window as any).__ASYAR_ROLE__ = 'view';
    invokeSpy.mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    const proxy = new ExtensionStateProxy();
    proxy.installViewAutoUnsubscribe();
    await proxy.subscribe('a', () => {});
    await proxy.subscribe('b', () => {});
    await proxy.subscribe('c', () => {});

    invokeSpy
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    window.dispatchEvent(new Event('pagehide'));
    // pagehide handler is async — wait a microtask.
    await Promise.resolve();
    await Promise.resolve();

    const unsubCalls = invokeSpy.mock.calls.filter((c: unknown[]) => c[0] === 'state:unsubscribe');
    expect(unsubCalls.length).toBeGreaterThanOrEqual(3);
    const ids = unsubCalls.map((c: unknown[]) => (c[1] as { subscriptionId: number }).subscriptionId).sort();
    expect(ids).toEqual([1, 2, 3]);
    delete (window as any).__ASYAR_ROLE__;
  });

  // ── module singleton ───────────────────────────────────────────────────

  it('exports a module-singleton instance per service-singletons skill', () => {
    expect(extensionStateProxy).toBeInstanceOf(ExtensionStateProxy);
  });
});
