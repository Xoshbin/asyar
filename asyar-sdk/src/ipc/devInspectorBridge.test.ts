/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { emitRpcLog, emitIpcLog, isInspectorActive } from './devInspectorBridge';

function setFlag(active: boolean | undefined) {
  if (active === undefined) {
    delete (window as any).__ASYAR_DEV_INSPECTOR_ACTIVE__;
  } else {
    (window as any).__ASYAR_DEV_INSPECTOR_ACTIVE__ = active;
  }
}

describe('devInspectorBridge — flag-gated diagnostic emitters', () => {
  const originalParentDescriptor = Object.getOwnPropertyDescriptor(window, 'parent');

  beforeEach(() => {
    setFlag(undefined);
  });

  afterEach(() => {
    setFlag(undefined);
    if (originalParentDescriptor) {
      Object.defineProperty(window, 'parent', originalParentDescriptor);
    }
  });

  it('isInspectorActive returns false when the flag is absent', () => {
    expect(isInspectorActive()).toBe(false);
  });

  it('isInspectorActive returns true only for exact `=== true`', () => {
    setFlag(true);
    expect(isInspectorActive()).toBe(true);

    (window as any).__ASYAR_DEV_INSPECTOR_ACTIVE__ = 'truthy-string';
    expect(isInspectorActive()).toBe(false);

    (window as any).__ASYAR_DEV_INSPECTOR_ACTIVE__ = 1;
    expect(isInspectorActive()).toBe(false);
  });

  it('emitRpcLog with flag absent fires no postMessage — regression lock', () => {
    const fakeParent = { postMessage: vi.fn() };
    Object.defineProperty(window, 'parent', {
      configurable: true,
      get: () => fakeParent,
    });

    emitRpcLog({
      phase: 'request',
      correlationId: 'abc',
      timestamp: 1000,
    });

    expect(fakeParent.postMessage).not.toHaveBeenCalled();
  });

  it('emitIpcLog with flag absent fires no postMessage — regression lock', () => {
    const fakeParent = { postMessage: vi.fn() };
    Object.defineProperty(window, 'parent', {
      configurable: true,
      get: () => fakeParent,
    });

    emitIpcLog({
      phase: 'invoke',
      command: 'storage:get',
      messageId: 'mid',
      timestamp: 1000,
    });

    expect(fakeParent.postMessage).not.toHaveBeenCalled();
  });

  it('emitRpcLog with flag set posts to window.parent with asyar:dev:rpc-log type', () => {
    setFlag(true);
    const fakeParent = { postMessage: vi.fn() };
    Object.defineProperty(window, 'parent', {
      configurable: true,
      get: () => fakeParent,
    });

    emitRpcLog({
      phase: 'request',
      id: 'doThing',
      correlationId: 'cor-1',
      payload: { x: 1 },
      timestamp: 1000,
    });

    expect(fakeParent.postMessage).toHaveBeenCalledOnce();
    const [message, origin] = fakeParent.postMessage.mock.calls[0];
    expect(message.type).toBe('asyar:dev:rpc-log');
    expect(message.payload.phase).toBe('request');
    expect(message.payload.correlationId).toBe('cor-1');
    expect(origin).toBe('*');
  });

  it('emitIpcLog with flag set posts asyar:dev:ipc-log to window.parent', () => {
    setFlag(true);
    const fakeParent = { postMessage: vi.fn() };
    Object.defineProperty(window, 'parent', {
      configurable: true,
      get: () => fakeParent,
    });

    emitIpcLog({
      phase: 'invoke',
      command: 'storage:get',
      payload: { key: 'x' },
      messageId: 'msg-1',
      timestamp: 2000,
    });

    expect(fakeParent.postMessage).toHaveBeenCalledOnce();
    const [message] = fakeParent.postMessage.mock.calls[0];
    expect(message.type).toBe('asyar:dev:ipc-log');
    expect(message.payload.command).toBe('storage:get');
  });

  it('emit functions are silent in host realm (parent === window)', () => {
    setFlag(true);
    Object.defineProperty(window, 'parent', {
      configurable: true,
      get: () => window,
    });
    // No fake postMessage replacement — we just assert no throw. The
    // function bails when parent === window. Also tests that setting the
    // flag in a host (launcher) context is harmless — extensions run as
    // iframes, but tests / the launcher itself loading the SDK would
    // otherwise loop-back onto themselves.
    expect(() =>
      emitRpcLog({ phase: 'request', correlationId: 'c', timestamp: 0 }),
    ).not.toThrow();
  });

  it('emit functions swallow postMessage errors', () => {
    setFlag(true);
    const fakeParent = {
      postMessage: vi.fn(() => {
        throw new Error('cross-origin');
      }),
    };
    Object.defineProperty(window, 'parent', {
      configurable: true,
      get: () => fakeParent,
    });
    expect(() =>
      emitIpcLog({ phase: 'invoke', command: 'x:y', messageId: 'm', timestamp: 0 }),
    ).not.toThrow();
  });
});
