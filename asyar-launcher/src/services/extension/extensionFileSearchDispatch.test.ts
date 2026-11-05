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
  invokeExtensionFileSearch,
  FILE_SEARCH_TIMEOUT_MS,
  MAX_FILE_SEARCH_RESULTS,
} from './extensionFileSearchDispatch';
import { pickExtensionIframe } from './extensionIframeSelector';

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

describe('invokeExtensionFileSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('posts asyar:fileSearch:query to worker and resolves with sanitized file results', async () => {
    const worker = mountedWorker();
    const promise = invokeExtensionFileSearch('org.example.gdrive', 'gdrive', {
      query: 'Financial Plan',
      limit: 5,
    });
    const message = postedMessage(worker);

    expect(pickExtensionIframe).toHaveBeenCalledWith('org.example.gdrive', 'worker', {});
    expect(worker.postMessage).toHaveBeenCalledWith(
      {
        type: 'asyar:fileSearch:query',
        messageId: message.messageId,
        payload: {
          providerId: 'gdrive',
          query: 'Financial Plan',
          limit: 5,
        },
      },
      '*',
    );

    window.dispatchEvent(
      new MessageEvent('message', {
        source: worker,
        data: {
          type: 'asyar:fileSearch:response',
          messageId: message.messageId,
          result: [
            {
              id: 'file-1',
              title: 'Q3 Financial Plan 2026',
              container: 'Finance / Shared',
              url: 'https://docs.google.com/document/d/1',
            },
          ],
        },
      }),
    );

    await expect(promise).resolves.toEqual([
      {
        id: 'file-1',
        title: 'Q3 Financial Plan 2026',
        container: 'Finance / Shared',
        url: 'https://docs.google.com/document/d/1',
        path: undefined,
        icon: undefined,
        mimeType: undefined,
        modifiedAt: undefined,
        size: undefined,
      },
    ]);
  });

  it('rejects when worker responds with error', async () => {
    const worker = mountedWorker();
    const promise = invokeExtensionFileSearch('org.example.gdrive', 'gdrive', {
      query: 'error test',
      limit: 5,
    });
    const message = postedMessage(worker);

    window.dispatchEvent(
      new MessageEvent('message', {
        source: worker,
        data: {
          type: 'asyar:fileSearch:response',
          messageId: message.messageId,
          error: 'Rate limit exceeded on Google Drive API',
        },
      }),
    );

    await expect(promise).rejects.toThrow('Rate limit exceeded on Google Drive API');
  });

  it('rejects on abort signal and notifies worker with asyar:fileSearch:abort', async () => {
    const worker = mountedWorker();
    const controller = new AbortController();
    const promise = invokeExtensionFileSearch(
      'org.example.gdrive',
      'gdrive',
      { query: 'abort test', limit: 5 },
      controller.signal,
    );
    const message = postedMessage(worker);

    controller.abort();

    await expect(promise).rejects.toThrow('Extension file search dispatch was cancelled');
    expect(worker.postMessage).toHaveBeenCalledWith(
      {
        type: 'asyar:fileSearch:abort',
        messageId: message.messageId,
      },
      '*',
    );
  });

  it('sanitizes unsafe non-http(s) URLs in results', async () => {
    const worker = mountedWorker();
    const promise = invokeExtensionFileSearch('org.example.gdrive', 'gdrive', {
      query: 'sanitize',
      limit: 5,
    });
    const message = postedMessage(worker);

    window.dispatchEvent(
      new MessageEvent('message', {
        source: worker,
        data: {
          type: 'asyar:fileSearch:response',
          messageId: message.messageId,
          result: [
            {
              id: 'file-bad',
              title: 'Evil File',
              url: 'javascript:alert(1)',
            },
            {
              id: 'file-good',
              title: 'Good File',
              url: 'https://example.com/good',
            },
          ],
        },
      }),
    );

    const res = await promise;
    expect(res).toHaveLength(2);
    expect(res[0].url).toBeUndefined(); // javascript: stripped
    expect(res[1].url).toBe('https://example.com/good');
  });

  it('clamps results array to maximum limit', async () => {
    const worker = mountedWorker();
    const promise = invokeExtensionFileSearch('org.example.gdrive', 'gdrive', {
      query: 'clamp test',
      limit: 2,
    });
    const message = postedMessage(worker);

    const manyFiles = Array.from({ length: 30 }, (_, i) => ({
      id: `file-${i}`,
      title: `Doc ${i}`,
      url: `https://example.com/${i}`,
    }));

    window.dispatchEvent(
      new MessageEvent('message', {
        source: worker,
        data: {
          type: 'asyar:fileSearch:response',
          messageId: message.messageId,
          result: manyFiles,
        },
      }),
    );

    const res = await promise;
    expect(res).toHaveLength(2);
  });

  it('times out after 4000ms', async () => {
    vi.useFakeTimers();
    const worker = mountedWorker();
    const promise = invokeExtensionFileSearch('org.example.gdrive', 'gdrive', {
      query: 'timeout test',
      limit: 5,
    });

    vi.advanceTimersByTime(FILE_SEARCH_TIMEOUT_MS + 10);
    await expect(promise).rejects.toThrow('timed out');
  });
});
