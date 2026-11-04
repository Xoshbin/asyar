/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./extensionIframeSelector', () => ({
  pickExtensionIframe: vi.fn(),
}));
vi.mock('./workerHost.svelte', () => ({
  workerHost: { hasWorker: vi.fn(() => false), getWorker: vi.fn(), post: vi.fn() },
}));
vi.mock('../../lib/ipc/extensionOrigin', () => ({
  getExtensionFrameOrigin: vi.fn().mockReturnValue('*'),
}));

import { invokeExtensionWebSearch, handleWebSearchResponse } from './extensionWebSearchDispatch';
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

describe('invokeExtensionWebSearch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('posts asyar:webSearch:query to the registered worker and resolves asyar:webSearch:response', async () => {
    const worker = mountedWorker();
    const promise = invokeExtensionWebSearch('org.example.keenable', 'keenable', {
      query: 'deep learning',
      limit: 5,
    });
    const message = postedMessage(worker);

    expect(pickExtensionIframe).toHaveBeenCalledWith('org.example.keenable', 'worker', {});
    expect(worker.postMessage).toHaveBeenCalledWith(
      {
        type: 'asyar:webSearch:query',
        messageId: message.messageId,
        payload: {
          engineId: 'keenable',
          query: 'deep learning',
          limit: 5,
        },
      },
      '*',
    );

    window.dispatchEvent(
      new MessageEvent('message', {
        source: worker,
        data: {
          type: 'asyar:webSearch:response',
          messageId: message.messageId,
          result: {
            sources: [{ title: 'DL Paper', url: 'https://example.com' }],
            results: [{ title: 'DL Paper', url: 'https://example.com', snippet: 'Intro to DL' }],
          },
        },
      }),
    );

    await expect(promise).resolves.toEqual({
      sources: [{ title: 'DL Paper', url: 'https://example.com' }],
      results: [{ title: 'DL Paper', url: 'https://example.com', snippet: 'Intro to DL' }],
    });
  });

  it('rejects when worker responds with error', async () => {
    const worker = mountedWorker();
    const promise = invokeExtensionWebSearch('org.example.keenable', 'keenable', { query: 'fail' });
    const message = postedMessage(worker);

    window.dispatchEvent(
      new MessageEvent('message', {
        source: worker,
        data: {
          type: 'asyar:webSearch:response',
          messageId: message.messageId,
          error: 'Rate limit exceeded',
        },
      }),
    );

    await expect(promise).rejects.toThrow('Rate limit exceeded');
  });

  it('rejects when abort signal is triggered', async () => {
    mountedWorker();
    const controller = new AbortController();
    const promise = invokeExtensionWebSearch(
      'org.example.keenable',
      'keenable',
      {},
      controller.signal,
    );
    controller.abort();
    await expect(promise).rejects.toThrow(/cancelled/i);
  });

  it('rejects if worker is not mounted', async () => {
    vi.mocked(pickExtensionIframe).mockReturnValue(null);
    vi.mocked(workerHost.getWorker).mockReturnValue(undefined);
    await expect(invokeExtensionWebSearch('org.missing', 'search', {})).rejects.toThrow(
      /not mounted/i,
    );
  });
});
