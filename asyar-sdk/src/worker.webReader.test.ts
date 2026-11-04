/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function setRole(role: string | undefined) {
  if (role === undefined) {
    delete (window as any).__ASYAR_ROLE__;
  } else {
    (window as any).__ASYAR_ROLE__ = role;
  }
}

describe('worker proxy bag — ai web reader service', () => {
  beforeEach(() => {
    vi.resetModules();
    setRole('worker');
  });

  afterEach(() => {
    setRole(undefined);
  });

  it('ExtensionContext.ai exposes registerWebReader method', async () => {
    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();
    expect(typeof ctx.ai.registerWebReader).toBe('function');
  });
});

describe('worker — asyar:webReader:query dispatch', () => {
  beforeEach(() => {
    vi.resetModules();
    setRole('worker');
  });

  afterEach(() => {
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
