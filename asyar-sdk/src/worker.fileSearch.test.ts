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

describe('worker proxy bag — file search provider service', () => {
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

  it('ExtensionContext.files exposes registerFileSearchProvider method', async () => {
    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();
    expect(typeof ctx.files.registerFileSearchProvider).toBe('function');
  });
});

describe('worker — asyar:fileSearch:query dispatch', () => {
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

  it('dispatches asyar:fileSearch:query to registered provider handler and posts response', async () => {
    const parentPostMessage = vi.fn();
    (window as any).parent = { postMessage: parentPostMessage };

    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();

    const mockSearch = vi.fn().mockResolvedValue([
      {
        id: 'file-123',
        title: 'Q3 Financial Plan 2026',
        container: 'Finance / Shared',
        url: 'https://docs.google.com/document/d/123',
      },
    ]);

    ctx.files.registerFileSearchProvider({
      id: 'gdrive',
      search: mockSearch,
    });

    const event = new MessageEvent('message', {
      data: {
        type: 'asyar:fileSearch:query',
        messageId: 'fsq-1',
        payload: {
          providerId: 'gdrive',
          query: 'Q3 Financial',
          limit: 10,
        },
      },
    });

    for (const listener of messageListeners) {
      await listener(event);
    }

    expect(mockSearch).toHaveBeenCalledWith(
      {
        query: 'Q3 Financial',
        limit: 10,
      },
      expect.any(AbortSignal),
    );

    expect(parentPostMessage).toHaveBeenCalledWith(
      {
        type: 'asyar:fileSearch:response',
        messageId: 'fsq-1',
        result: [
          {
            id: 'file-123',
            title: 'Q3 Financial Plan 2026',
            container: 'Finance / Shared',
            url: 'https://docs.google.com/document/d/123',
          },
        ],
      },
      '*',
    );
  });

  it('posts error response when handler throws', async () => {
    const parentPostMessage = vi.fn();
    (window as any).parent = { postMessage: parentPostMessage };

    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();

    ctx.files.registerFileSearchProvider({
      id: 'gdrive',
      search: vi.fn().mockRejectedValue(new Error('Google Drive API rate limit')),
    });

    const event = new MessageEvent('message', {
      data: {
        type: 'asyar:fileSearch:query',
        messageId: 'fsq-err',
        payload: {
          providerId: 'gdrive',
          query: 'fail query',
          limit: 5,
        },
      },
    });

    for (const listener of messageListeners) {
      await listener(event);
    }

    expect(parentPostMessage).toHaveBeenCalledWith(
      {
        type: 'asyar:fileSearch:response',
        messageId: 'fsq-err',
        error: 'Google Drive API rate limit',
      },
      '*',
    );
  });

  it('aborts active search when receiving asyar:fileSearch:abort', async () => {
    const parentPostMessage = vi.fn();
    (window as any).parent = { postMessage: parentPostMessage };

    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();

    let capturedSignal: AbortSignal | undefined;
    const pendingPromise = new Promise<any>((_, reject) => {
      // hangs until aborted
      setTimeout(() => reject(new Error('timeout')), 5000);
    });

    ctx.files.registerFileSearchProvider({
      id: 'gdrive',
      search: vi.fn().mockImplementation((_query, signal) => {
        capturedSignal = signal;
        return pendingPromise;
      }),
    });

    const queryEvent = new MessageEvent('message', {
      data: {
        type: 'asyar:fileSearch:query',
        messageId: 'fsq-abort-test',
        payload: {
          providerId: 'gdrive',
          query: 'abort me',
        },
      },
    });

    for (const listener of messageListeners) {
      void listener(queryEvent);
    }

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    const abortEvent = new MessageEvent('message', {
      data: {
        type: 'asyar:fileSearch:abort',
        messageId: 'fsq-abort-test',
      },
    });

    for (const listener of messageListeners) {
      await listener(abortEvent);
    }

    expect(capturedSignal?.aborted).toBe(true);
  });
});
