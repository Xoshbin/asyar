/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { messageBroker } from '../ipc/MessageBroker';
import { ExtensionRpc, extensionRpc } from './ExtensionRpc';

describe('ExtensionRpc', () => {
  let invokeSpy: ReturnType<typeof vi.spyOn>;
  let onSpy: ReturnType<typeof vi.spyOn>;
  let pushHandlers: Map<string, Array<(payload: unknown) => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
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
  });

  afterEach(() => {
    vi.useRealTimers();
    invokeSpy.mockRestore();
    onSpy.mockRestore();
  });

  function deliverPush(event: string, payload: unknown) {
    for (const h of pushHandlers.get(event) ?? []) h(payload);
  }

  // ── view-side: request → reply happy path ──────────────────────────────

  it('request invokes state:rpcRequest with id, correlationId, payload', async () => {
    invokeSpy.mockResolvedValue(undefined);
    const rpc = new ExtensionRpc();
    rpc.installViewMessageListener();

    const promise = rpc.request('start', { minutes: 25 });
    // Microtask for the await on broker.invoke inside request.
    await Promise.resolve();

    expect(invokeSpy).toHaveBeenCalledTimes(1);
    const [type, payload] = invokeSpy.mock.calls[0];
    expect(type).toBe('state:rpcRequest');
    expect(payload).toMatchObject({
      id: 'start',
      payload: { minutes: 25 },
    });
    const correlationId = (payload as { correlationId: string }).correlationId;
    expect(typeof correlationId).toBe('string');
    expect(correlationId.length).toBeGreaterThan(0);

    // Deliver the reply.
    deliverPush('asyar:event:state:rpc-reply:push', {
      correlationId,
      result: { ok: true },
    });
    expect(await promise).toEqual({ ok: true });
  });

  it('request rejects when the reply carries an error', async () => {
    invokeSpy.mockResolvedValue(undefined);
    const rpc = new ExtensionRpc();
    rpc.installViewMessageListener();

    const promise = rpc.request('start', {});
    await Promise.resolve();
    const correlationId = (invokeSpy.mock.calls[0][1] as { correlationId: string }).correlationId;
    deliverPush('asyar:event:state:rpc-reply:push', {
      correlationId,
      error: 'handler threw',
    });
    await expect(promise).rejects.toThrow(/handler threw/);
  });

  // ── timeout & abort ────────────────────────────────────────────────────

  it('request rejects after default 5000ms timeout', async () => {
    invokeSpy.mockResolvedValue(undefined);
    const rpc = new ExtensionRpc();
    rpc.installViewMessageListener();

    const promise = rpc.request('slow', {});
    await Promise.resolve();
    vi.advanceTimersByTime(4999);
    // Still pending.
    let settled = false;
    promise.catch(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    vi.advanceTimersByTime(2);
    await expect(promise).rejects.toThrow(/timeout/i);
  });

  it('request honours per-call timeoutMs override', async () => {
    invokeSpy.mockResolvedValue(undefined);
    const rpc = new ExtensionRpc();
    rpc.installViewMessageListener();

    const promise = rpc.request('slow', {}, { timeoutMs: 100 });
    await Promise.resolve();
    vi.advanceTimersByTime(101);
    await expect(promise).rejects.toThrow(/timeout/i);
  });

  it('on timeout, fires state:rpcAbort to the worker so the in-flight handler can bail', async () => {
    invokeSpy.mockResolvedValue(undefined);
    const rpc = new ExtensionRpc();
    rpc.installViewMessageListener();

    const promise = rpc.request('slow', {}, { timeoutMs: 50 });
    await Promise.resolve();
    const corrId = (invokeSpy.mock.calls[0][1] as { correlationId: string }).correlationId;
    invokeSpy.mockClear();

    vi.advanceTimersByTime(60);
    await promise.catch(() => {});

    const abortCall = invokeSpy.mock.calls.find((c: unknown[]) => c[0] === 'state:rpcAbort');
    expect(abortCall).toBeDefined();
    expect(abortCall![1]).toEqual({ correlationId: corrId });
  });

  it('stale reply arriving after timeout is silently dropped (no double settle)', async () => {
    invokeSpy.mockResolvedValue(undefined);
    const rpc = new ExtensionRpc();
    rpc.installViewMessageListener();

    const promise = rpc.request('slow', {}, { timeoutMs: 10 });
    await Promise.resolve();
    const corrId = (invokeSpy.mock.calls[0][1] as { correlationId: string }).correlationId;
    vi.advanceTimersByTime(20);
    await expect(promise).rejects.toThrow(/timeout/i);

    // Stale reply arrives: must not throw, must not warn loudly.
    expect(() =>
      deliverPush('asyar:event:state:rpc-reply:push', {
        correlationId: corrId,
        result: { tooLate: true },
      }),
    ).not.toThrow();
  });

  it('pagehide clears pending-reply entries silently', async () => {
    invokeSpy.mockResolvedValue(undefined);
    const rpc = new ExtensionRpc();
    rpc.installViewMessageListener();

    const promise = rpc.request('slow', {}, { timeoutMs: 60_000 });
    await Promise.resolve();
    rpc.disposeAllPending();
    // pagehide cleanup leaves the promise pending until next mount; the
    // contract is "no zombie state survives". We assert by attempting to
    // settle with a stale reply and observing nothing fires.
    deliverPush('asyar:event:state:rpc-reply:push', {
      correlationId: (invokeSpy.mock.calls[0][1] as { correlationId: string }).correlationId,
      result: 'should be dropped',
    });
    let resolved: unknown = undefined;
    promise.then((r) => (resolved = r)).catch(() => {});
    await Promise.resolve();
    expect(resolved).toBeUndefined();
  });

  // ── worker-side: onRequest dispatches matching id with abort signal ────

  it('onRequest registers a handler that fires when matching __rpc__:request arrives', async () => {
    const rpc = new ExtensionRpc();
    rpc.installWorkerMessageListener();

    const handler = vi.fn().mockResolvedValue({ done: true });
    rpc.onRequest('start', handler);

    invokeSpy.mockResolvedValue(undefined);
    rpc.deliverActionPayload({
      __rpc__: 'request',
      id: 'start',
      correlationId: 'c1',
      payload: { x: 1 },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1);
    const [callPayload, signal] = handler.mock.calls[0];
    expect(callPayload).toEqual({ x: 1 });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  it('worker-side handler reply is sent via state:rpcReply', async () => {
    const rpc = new ExtensionRpc();
    rpc.installWorkerMessageListener();

    rpc.onRequest('start', async () => ({ done: true }));

    invokeSpy.mockResolvedValue(undefined);
    rpc.deliverActionPayload({
      __rpc__: 'request',
      id: 'start',
      correlationId: 'c1',
      payload: {},
    });

    // Wait for the async handler to resolve and the reply to be sent.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const reply = invokeSpy.mock.calls.find((c: unknown[]) => c[0] === 'state:rpcReply');
    expect(reply).toBeDefined();
    expect(reply![1]).toEqual({
      correlationId: 'c1',
      result: { done: true },
    });
  });

  it('worker-side handler error is forwarded as { error } in state:rpcReply', async () => {
    const rpc = new ExtensionRpc();
    rpc.installWorkerMessageListener();

    rpc.onRequest('start', async () => {
      throw new Error('boom');
    });

    invokeSpy.mockResolvedValue(undefined);
    rpc.deliverActionPayload({
      __rpc__: 'request',
      id: 'start',
      correlationId: 'c1',
      payload: {},
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const reply = invokeSpy.mock.calls.find((c: unknown[]) => c[0] === 'state:rpcReply');
    expect(reply).toBeDefined();
    expect((reply![1] as { error: string }).error).toMatch(/boom/);
  });

  it('__rpc__:abort fires the AbortSignal on the in-flight handler', async () => {
    const rpc = new ExtensionRpc();
    rpc.installWorkerMessageListener();

    let capturedSignal: AbortSignal | undefined;
    rpc.onRequest(
      'slow',
      (_payload: unknown, signal: AbortSignal) =>
        new Promise(() => {
          capturedSignal = signal;
        }),
    );

    invokeSpy.mockResolvedValue(undefined);
    rpc.deliverActionPayload({
      __rpc__: 'request',
      id: 'slow',
      correlationId: 'c1',
      payload: {},
    });
    await Promise.resolve();
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);

    rpc.deliverActionPayload({
      __rpc__: 'abort',
      correlationId: 'c1',
    });
    expect(capturedSignal!.aborted).toBe(true);
  });

  it('worker-side: __rpc__:request for an unregistered id returns an error reply', async () => {
    const rpc = new ExtensionRpc();
    rpc.installWorkerMessageListener();

    invokeSpy.mockResolvedValue(undefined);
    rpc.deliverActionPayload({
      __rpc__: 'request',
      id: 'unregistered',
      correlationId: 'c1',
      payload: {},
    });

    await Promise.resolve();
    await Promise.resolve();

    const reply = invokeSpy.mock.calls.find((c: unknown[]) => c[0] === 'state:rpcReply');
    expect(reply).toBeDefined();
    expect((reply![1] as { error: string }).error).toMatch(/unregistered|no handler/i);
  });

  // ── singleton ──────────────────────────────────────────────────────────

  it('exports a module-singleton instance', () => {
    expect(extensionRpc).toBeInstanceOf(ExtensionRpc);
  });
});
