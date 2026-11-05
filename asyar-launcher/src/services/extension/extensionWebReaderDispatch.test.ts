/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./extensionIframeSelector', () => ({
  pickExtensionIframe: vi.fn(),
}));
vi.mock('./workerHost.svelte', () => ({
  workerHost: { hasWorker: vi.fn(() => false), getWorker: vi.fn(), post: vi.fn() },
}));
vi.mock('../../lib/ipc/extensionOrigin', () => ({
  getExtensionFrameOrigin: vi.fn().mockReturnValue('*'),
}));

import {
  invokeExtensionWebReader,
  handleWebReaderResponse,
  WEB_READER_MAX_CHARS,
} from './extensionWebReaderDispatch';
import { pickExtensionIframe } from './extensionIframeSelector';
import { workerHost } from './workerHost.svelte';

function mountedWorker(): Window {
  const worker = { postMessage: vi.fn() } as unknown as Window;
  vi.mocked(pickExtensionIframe).mockReturnValue({ contentWindow: worker } as HTMLIFrameElement);
  return worker;
}

function postedMessage(worker: Window): { messageId: string; payload: unknown } {
  return vi.mocked(worker.postMessage).mock.calls[0][0] as {
    messageId: string;
    payload: unknown;
  };
}

describe('invokeExtensionWebReader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('posts asyar:webReader:query to worker and resolves asyar:webReader:response', async () => {
    const worker = mountedWorker();
    const promise = invokeExtensionWebReader('org.example.jina', 'jina-reader', {
      url: 'https://example.com/article',
      apiKey: 'jina_123',
    });
    const message = postedMessage(worker);

    expect(pickExtensionIframe).toHaveBeenCalledWith('org.example.jina', 'worker', {});
    expect(worker.postMessage).toHaveBeenCalledWith(
      {
        type: 'asyar:webReader:query',
        messageId: message.messageId,
        payload: {
          readerId: 'jina-reader',
          url: 'https://example.com/article',
          apiKey: 'jina_123',
          baseUrl: undefined,
        },
      },
      '*',
    );

    window.dispatchEvent(
      new MessageEvent('message', {
        source: worker,
        data: {
          type: 'asyar:webReader:response',
          messageId: message.messageId,
          result: {
            url: 'https://example.com/article',
            title: 'Example Article',
            content: '# Example Article\nClean markdown content.',
            status: 200,
          },
        },
      }),
    );

    await expect(promise).resolves.toEqual({
      url: 'https://example.com/article',
      title: 'Example Article',
      content: '# Example Article\nClean markdown content.',
      status: 200,
      metadata: undefined,
    });
  });

  it('truncates content exceeding 100,000 characters', async () => {
    const worker = mountedWorker();
    const promise = invokeExtensionWebReader('org.example.jina', 'jina-reader', {
      url: 'https://example.com/huge',
    });
    const message = postedMessage(worker);

    const hugeContent = 'a'.repeat(120_000);

    window.dispatchEvent(
      new MessageEvent('message', {
        source: worker,
        data: {
          type: 'asyar:webReader:response',
          messageId: message.messageId,
          result: {
            url: 'https://example.com/huge',
            title: 'Huge Page',
            content: hugeContent,
          },
        },
      }),
    );

    const res = await promise;
    expect(res.content.length).toBe(
      WEB_READER_MAX_CHARS + '\n\n[Content truncated by Asyar Web Reader limit]'.length,
    );
    expect(res.content.endsWith('\n\n[Content truncated by Asyar Web Reader limit]')).toBe(true);
    expect(res.content.startsWith('a'.repeat(100))).toBe(true);
  });

  it('rejects when worker responds with error', async () => {
    const worker = mountedWorker();
    const promise = invokeExtensionWebReader('org.example.jina', 'jina-reader', {
      url: 'https://example.com/protected',
    });
    const message = postedMessage(worker);

    window.dispatchEvent(
      new MessageEvent('message', {
        source: worker,
        data: {
          type: 'asyar:webReader:response',
          messageId: message.messageId,
          error: 'Cloudflare bot detection blocked extraction',
        },
      }),
    );

    await expect(promise).rejects.toThrow('Cloudflare bot detection blocked extraction');
  });

  it('rejects when abort signal is triggered and notifies worker', async () => {
    const worker = mountedWorker();
    const controller = new AbortController();
    const promise = invokeExtensionWebReader(
      'org.example.jina',
      'jina-reader',
      { url: 'https://example.com' },
      controller.signal,
    );
    const message = postedMessage(worker);
    controller.abort();
    await expect(promise).rejects.toThrow(/cancelled/i);
    expect(worker.postMessage).toHaveBeenCalledWith(
      {
        type: 'asyar:webReader:abort',
        messageId: message.messageId,
      },
      '*',
    );
  });

  it('rejects if worker is not mounted', async () => {
    vi.mocked(pickExtensionIframe).mockReturnValue(null);
    vi.mocked(workerHost.getWorker).mockReturnValue(undefined);
    await expect(
      invokeExtensionWebReader('org.missing', 'reader', { url: 'https://example.com' }),
    ).rejects.toThrow(/not mounted/i);
  });

  it('times out and rejects when worker does not reply within 20s, notifying worker of abort', async () => {
    vi.useFakeTimers();
    const worker = mountedWorker();
    const promise = invokeExtensionWebReader('org.example.jina', 'jina-reader', {
      url: 'https://example.com/hang',
    });
    const message = postedMessage(worker);

    vi.advanceTimersByTime(20_001);

    await expect(promise).rejects.toThrow(/timed out after 20s/i);
    expect(worker.postMessage).toHaveBeenCalledWith(
      {
        type: 'asyar:webReader:abort',
        messageId: message.messageId,
      },
      '*',
    );
  });
});
