/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/iframeLifecycleCommands', () => ({
  iframeReadyAck: vi.fn(),
  iframeMountTimeoutReported: vi.fn(),
}));
vi.mock('./extensionDelivery', () => ({ post: vi.fn() }));
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { iframeReadyAck } from '../../lib/ipc/iframeLifecycleCommands';
import { post } from './extensionDelivery';
import { extensionReadinessListener } from './extensionReadinessListener';

function makeIframe(id: string, token: string) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('data-extension-id', id);
  iframe.setAttribute('data-mount-token', token);
  Object.defineProperty(iframe, 'contentWindow', {
    value: { postMessage: vi.fn() } as any,
    configurable: true,
  });
  document.body.appendChild(iframe);
  return iframe;
}

describe('extensionReadinessListener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.replaceChildren();
    extensionReadinessListener.reset();
    extensionReadinessListener.init();
  });

  it('on asyar:extension:loaded from a known iframe, calls iframeReadyAck and posts drained messages', async () => {
    const iframe = makeIframe('ext.a', '7');
    vi.mocked(iframeReadyAck).mockResolvedValueOnce([
      { kind: 'command', payload: { commandId: 'x' }, source: 'search' },
    ]);

    const event = new MessageEvent('message', {
      data: { type: 'asyar:extension:loaded', extensionId: 'ext.a' },
      source: iframe.contentWindow as any,
    });
    window.dispatchEvent(event);
    await Promise.resolve();
    await Promise.resolve();

    expect(iframeReadyAck).toHaveBeenCalledWith('ext.a', 7);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('ignores messages whose iframe has no data-mount-token', async () => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('data-extension-id', 'ext.a');
    Object.defineProperty(iframe, 'contentWindow', {
      value: { postMessage: vi.fn() } as any,
      configurable: true,
    });
    document.body.appendChild(iframe);

    const event = new MessageEvent('message', {
      data: { type: 'asyar:extension:loaded', extensionId: 'ext.a' },
      source: iframe.contentWindow as any,
    });
    window.dispatchEvent(event);
    await Promise.resolve();
    expect(iframeReadyAck).not.toHaveBeenCalled();
  });

  it('ignores non asyar:extension:loaded messages', async () => {
    const iframe = makeIframe('ext.a', '7');
    const event = new MessageEvent('message', {
      data: { type: 'something:else' },
      source: iframe.contentWindow as any,
    });
    window.dispatchEvent(event);
    await Promise.resolve();
    expect(iframeReadyAck).not.toHaveBeenCalled();
  });
});
