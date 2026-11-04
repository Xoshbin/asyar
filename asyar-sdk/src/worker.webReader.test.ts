/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function setRole(role: string | undefined) {
  if (role === undefined) {
    delete (window as any).__ASYAR_ROLE__;
  } else {
    (window as any).__ASYAR_ROLE__ = role;
  }
}

let messageListeners: EventListener[] = [];
const originalAddEventListener = window.addEventListener.bind(window);
const originalRemoveEventListener = window.removeEventListener.bind(window);

describe('worker proxy bag — ai web reader service', () => {
  beforeEach(() => {
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === 'message' && typeof listener === 'function') {
        messageListeners.push(listener as EventListener);
      }
      return originalAddEventListener(type, listener, options);
    });
    vi.resetModules();
    setRole('worker');
  });

  afterEach(() => {
    for (const listener of messageListeners) {
      originalRemoveEventListener('message', listener);
    }
    messageListeners = [];
    setRole(undefined);
    vi.restoreAllMocks();
  });

  it('ExtensionContext.ai exposes registerWebReader method', async () => {
    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();
    expect(typeof ctx.ai.registerWebReader).toBe('function');
  });
});

describe('worker — asyar:webReader:query dispatch', () => {
  beforeEach(() => {
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === 'message' && typeof listener === 'function') {
        messageListeners.push(listener as EventListener);
      }
      return originalAddEventListener(type, listener, options);
    });
    vi.resetModules();
    setRole('worker');
  });

  afterEach(() => {
    for (const listener of messageListeners) {
      originalRemoveEventListener('message', listener);
    }
    messageListeners = [];
    setRole(undefined);
    vi.restoreAllMocks();
  });

  it('dispatches asyar:webReader:query to registered reader handler and posts response', async () => {
    const parentPostMessage = vi.fn();
    (window as any).parent = { postMessage: parentPostMessage };

    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();

    const mockRead = vi.fn().mockResolvedValue({
      url: 'https://example.com/blog',
      title: 'Blog Post',
      content: '# Blog Post\n\nClean markdown content',
      status: 200,
    });

    ctx.ai.registerWebReader({
      id: 'jina-reader',
      read: mockRead,
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'asyar:webReader:query',
          messageId: 'msg-reader-123',
          payload: {
            readerId: 'jina-reader',
            url: 'https://example.com/blog',
            apiKey: 'jina_secret_key',
            baseUrl: 'https://r.jina.ai',
          },
        },
      }),
    );

    await new Promise((r) => setTimeout(r, 10));

    expect(mockRead).toHaveBeenCalledWith(
      {
        url: 'https://example.com/blog',
        apiKey: 'jina_secret_key',
        baseUrl: 'https://r.jina.ai',
      },
      expect.any(AbortSignal),
    );

    expect(parentPostMessage).toHaveBeenCalledTimes(1);
    expect(parentPostMessage).toHaveBeenCalledWith(
      {
        type: 'asyar:webReader:response',
        messageId: 'msg-reader-123',
        result: {
          url: 'https://example.com/blog',
          title: 'Blog Post',
          content: '# Blog Post\n\nClean markdown content',
          status: 200,
        },
      },
      '*',
    );
  });

  it('normalizes null apiKey and baseUrl values to undefined', async () => {
    const parentPostMessage = vi.fn();
    (window as any).parent = { postMessage: parentPostMessage };

    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();

    const mockRead = vi.fn().mockResolvedValue({
      url: 'https://example.com/item',
      content: 'Item content',
    });

    ctx.ai.registerWebReader({
      id: 'null-test-reader',
      read: mockRead,
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'asyar:webReader:query',
          messageId: 'msg-null-test',
          payload: {
            readerId: 'null-test-reader',
            url: 'https://example.com/item',
            apiKey: null,
            baseUrl: null,
          },
        },
      }),
    );

    await new Promise((r) => setTimeout(r, 10));

    expect(mockRead).toHaveBeenCalledWith(
      {
        url: 'https://example.com/item',
        apiKey: undefined,
        baseUrl: undefined,
      },
      expect.any(AbortSignal),
    );
    expect(parentPostMessage).toHaveBeenCalledTimes(1);
  });

  it('aborts handler when asyar:webReader:abort message is received', async () => {
    const parentPostMessage = vi.fn();
    (window as any).parent = { postMessage: parentPostMessage };

    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();

    let capturedSignal: AbortSignal | undefined;
    const mockRead = vi.fn().mockImplementation((_query, signal) => {
      capturedSignal = signal;
      return new Promise((resolve) => setTimeout(resolve, 5000));
    });

    ctx.ai.registerWebReader({
      id: 'abort-reader',
      read: mockRead,
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'asyar:webReader:query',
          messageId: 'msg-abort-test',
          payload: {
            readerId: 'abort-reader',
            url: 'https://example.com/slow',
          },
        },
      }),
    );

    await new Promise((r) => setTimeout(r, 10));
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'asyar:webReader:abort',
          messageId: 'msg-abort-test',
        },
      }),
    );

    expect(capturedSignal?.aborted).toBe(true);
  });

  it('posts error response when reader handler throws', async () => {
    const parentPostMessage = vi.fn();
    (window as any).parent = { postMessage: parentPostMessage };

    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();

    ctx.ai.registerWebReader({
      id: 'failing-reader',
      read: vi.fn().mockRejectedValue(new Error('Rate limit exceeded (429)')),
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'asyar:webReader:query',
          messageId: 'msg-reader-err',
          payload: {
            readerId: 'failing-reader',
            url: 'https://example.com/fail',
          },
        },
      }),
    );

    await new Promise((r) => setTimeout(r, 10));

    expect(parentPostMessage).toHaveBeenCalledTimes(1);
    expect(parentPostMessage).toHaveBeenCalledWith(
      {
        type: 'asyar:webReader:response',
        messageId: 'msg-reader-err',
        error: 'Rate limit exceeded (429)',
      },
      '*',
    );
  });
});
