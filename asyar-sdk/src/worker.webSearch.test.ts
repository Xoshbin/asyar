/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function setRole(role: string | undefined) {
  if (role === undefined) {
    delete (window as any).__ASYAR_ROLE__;
  } else {
    (window as any).__ASYAR_ROLE__ = role;
  }
}

describe('worker proxy bag — ai web search service', () => {
  beforeEach(() => {
    vi.resetModules();
    setRole('worker');
  });

  afterEach(() => {
    setRole(undefined);
  });

  it('ExtensionContext.ai exposes registerWebSearchEngine method', async () => {
    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();
    expect(typeof ctx.ai.registerWebSearchEngine).toBe('function');
  });
});

describe('worker — asyar:webSearch:query dispatch', () => {
  beforeEach(() => {
    vi.resetModules();
    setRole('worker');
  });

  afterEach(() => {
    setRole(undefined);
    vi.restoreAllMocks();
  });

  it('dispatches asyar:webSearch:query to registered search handler and posts response', async () => {
    const parentPostMessage = vi.fn();
    (window as any).parent = { postMessage: parentPostMessage };

    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();

    const mockSearch = vi.fn().mockResolvedValue({
      sources: [{ title: 'Asyar', url: 'https://asyar.org' }],
      results: [{ title: 'Asyar', url: 'https://asyar.org', snippet: 'Fast Launcher' }],
    });

    ctx.ai.registerWebSearchEngine({
      id: 'keenable',
      search: mockSearch,
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'asyar:webSearch:query',
          messageId: 'msg-search-123',
          payload: {
            engineId: 'keenable',
            query: 'Asyar desktop',
            limit: 5,
            apiKey: 'test-key',
          },
        },
      }),
    );

    await new Promise((r) => setTimeout(r, 10));

    expect(mockSearch).toHaveBeenCalledWith(
      {
        query: 'Asyar desktop',
        limit: 5,
        apiKey: 'test-key',
        baseUrl: undefined,
      },
      expect.any(AbortSignal),
    );

    expect(parentPostMessage).toHaveBeenCalledWith(
      {
        type: 'asyar:webSearch:response',
        messageId: 'msg-search-123',
        result: {
          sources: [{ title: 'Asyar', url: 'https://asyar.org' }],
          results: [{ title: 'Asyar', url: 'https://asyar.org', snippet: 'Fast Launcher' }],
        },
      },
      '*',
    );
  });

  it('posts error response if handler rejects', async () => {
    const parentPostMessage = vi.fn();
    (window as any).parent = { postMessage: parentPostMessage };

    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();

    ctx.ai.registerWebSearchEngine({
      id: 'failing-engine',
      search: vi.fn().mockRejectedValue(new Error('Network error (503)')),
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'asyar:webSearch:query',
          messageId: 'msg-err-456',
          payload: {
            engineId: 'failing-engine',
            query: 'test',
          },
        },
      }),
    );

    await new Promise((r) => setTimeout(r, 10));

    expect(parentPostMessage).toHaveBeenCalledWith(
      {
        type: 'asyar:webSearch:response',
        messageId: 'msg-err-456',
        error: 'Network error (503)',
      },
      '*',
    );
  });
});
