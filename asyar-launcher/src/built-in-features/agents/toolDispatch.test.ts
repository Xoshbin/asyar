/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/extension/extensionIframeSelector', () => ({
  pickExtensionIframe: vi.fn(),
}));
vi.mock('../../lib/ipc/extensionOrigin', () => ({
  getExtensionFrameOrigin: vi.fn().mockReturnValue('*'),
}));

import { invokeExtensionTool } from './toolDispatch';
import { pickExtensionIframe } from '../../services/extension/extensionIframeSelector';

function mountedWorker(): Window {
  const worker = { postMessage: vi.fn() } as unknown as Window;
  vi.mocked(pickExtensionIframe).mockReturnValue({ contentWindow: worker } as HTMLIFrameElement);
  return worker;
}

function postedMessage(worker: Window): { messageId: string } {
  return vi.mocked(worker.postMessage).mock.calls[0][0] as { messageId: string };
}

describe('invokeExtensionTool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('posts to the registered worker and resolves its response', async () => {
    const worker = mountedWorker();
    const promise = invokeExtensionTool('org.example.notes', 'lookup', { query: 'x' });
    const message = postedMessage(worker);

    expect(pickExtensionIframe).toHaveBeenCalledWith('org.example.notes', 'worker');
    expect(worker.postMessage).toHaveBeenCalledWith(
      {
        type: 'asyar:tools:invoke',
        messageId: message.messageId,
        payload: { id: 'lookup', args: { query: 'x' } },
      },
      '*',
    );

    window.dispatchEvent(
      new MessageEvent('message', {
        source: worker,
        data: {
          type: 'asyar:tools:invoke:response',
          messageId: message.messageId,
          result: { answer: 42 },
        },
      }),
    );
    await expect(promise).resolves.toEqual({ answer: 42 });
  });

  it('ignores a forged response from a different window', async () => {
    const worker = mountedWorker();
    const promise = invokeExtensionTool('org.example.notes', 'lookup', {});
    const message = postedMessage(worker);

    window.dispatchEvent(
      new MessageEvent('message', {
        source: {} as Window,
        data: {
          type: 'asyar:tools:invoke:response',
          messageId: message.messageId,
          result: 'forged',
        },
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        source: worker,
        data: {
          type: 'asyar:tools:invoke:response',
          messageId: message.messageId,
          result: 'trusted',
        },
      }),
    );

    await expect(promise).resolves.toBe('trusted');
  });

  it('removes the pending response when Rust cancels the dispatch', async () => {
    mountedWorker();
    const controller = new AbortController();
    const promise = invokeExtensionTool('org.example.notes', 'lookup', {}, controller.signal);

    controller.abort();

    await expect(promise).rejects.toThrow(/cancelled/i);
  });

  it('rejects when the extension worker is not mounted', async () => {
    vi.mocked(pickExtensionIframe).mockReturnValue(null);
    await expect(invokeExtensionTool('org.missing', 'lookup', {})).rejects.toThrow(/not mounted/i);
  });
});
