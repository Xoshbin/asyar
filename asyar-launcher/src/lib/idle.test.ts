/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const win = window as unknown as {
  requestIdleCallback?: unknown;
  cancelIdleCallback?: unknown;
};

// idle.ts keeps a module-level installed flag, so each test gets a fresh
// module instance. jsdom has no native requestIdleCallback; tests that need
// one present stub it explicitly.
async function freshIdle() {
  vi.resetModules();
  return await import('./idle');
}

beforeEach(() => {
  vi.useFakeTimers();
  delete win.requestIdleCallback;
  delete win.cancelIdleCallback;
});

afterEach(() => {
  vi.useRealTimers();
  delete win.requestIdleCallback;
  delete win.cancelIdleCallback;
});

describe('installIdleCallbackPolyfill', () => {
  it('installs a shim that fires at the caller timeout with didTimeout set', async () => {
    const { installIdleCallbackPolyfill } = await freshIdle();
    installIdleCallbackPolyfill();

    const cb = vi.fn();
    window.requestIdleCallback(cb, { timeout: 1000 });

    vi.advanceTimersByTime(999);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledOnce();

    const deadline = cb.mock.calls[0][0];
    expect(deadline.didTimeout).toBe(true);
    expect(deadline.timeRemaining()).toBeGreaterThanOrEqual(0);
  });

  it('leaves a native implementation untouched', async () => {
    const native = vi.fn();
    win.requestIdleCallback = native;

    const { installIdleCallbackPolyfill } = await freshIdle();
    installIdleCallbackPolyfill();

    expect(window.requestIdleCallback).toBe(native);
  });

  it('installs a cancelIdleCallback that cancels a scheduled task', async () => {
    const { installIdleCallbackPolyfill } = await freshIdle();
    installIdleCallbackPolyfill();

    const cb = vi.fn();
    const id = window.requestIdleCallback(cb, { timeout: 500 });
    window.cancelIdleCallback(id);

    vi.advanceTimersByTime(500);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('runWhenIdle', () => {
  it('self-installs the polyfill and runs the task at the given timeout', async () => {
    const { runWhenIdle } = await freshIdle();

    const task = vi.fn();
    runWhenIdle(task, { timeout: 300 });
    expect(typeof window.requestIdleCallback).toBe('function');

    vi.advanceTimersByTime(299);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledOnce();
  });

  it('passes the timeout through to a native requestIdleCallback', async () => {
    const native = vi.fn();
    win.requestIdleCallback = native;

    const { runWhenIdle } = await freshIdle();
    runWhenIdle(() => {}, { timeout: 750 });

    expect(native).toHaveBeenCalledOnce();
    expect(native.mock.calls[0][1]).toEqual({ timeout: 750 });
  });
});
