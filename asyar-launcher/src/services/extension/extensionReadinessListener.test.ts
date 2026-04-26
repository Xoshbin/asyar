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
import { logService } from '../log/logService';
import { extensionReadinessListener } from './extensionReadinessListener';

function makeIframe(id: string, token: string) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('data-extension-id', id);
  iframe.setAttribute('data-mount-token', token);
  // NB: data-role is intentionally NOT read by the listener anymore.
  // role is carried in the asyar:extension:loaded event payload by the SDK.
  Object.defineProperty(iframe, 'contentWindow', {
    value: { postMessage: vi.fn() } as any,
    configurable: true,
  });
  document.body.appendChild(iframe);
  return iframe;
}

describe('extensionReadinessListener — reads role from asyar:extension:loaded payload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.replaceChildren();
    extensionReadinessListener.reset();
    extensionReadinessListener.init();
  });

  it('acks with role=view when payload.role === "view"', async () => {
    const iframe = makeIframe('ext.a', '7');
    vi.mocked(iframeReadyAck).mockResolvedValueOnce([
      { kind: 'command', payload: { commandId: 'x' }, source: 'search' } as any,
    ]);

    const event = new MessageEvent('message', {
      data: { type: 'asyar:extension:loaded', extensionId: 'ext.a', role: 'view' },
      source: iframe.contentWindow as any,
    });
    window.dispatchEvent(event);
    await Promise.resolve();
    await Promise.resolve();

    expect(iframeReadyAck).toHaveBeenCalledWith('ext.a', 7, 'view');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('acks with role=worker when payload.role === "worker"', async () => {
    const iframe = makeIframe('ext.a', '3');
    vi.mocked(iframeReadyAck).mockResolvedValueOnce([]);

    const event = new MessageEvent('message', {
      data: { type: 'asyar:extension:loaded', extensionId: 'ext.a', role: 'worker' },
      source: iframe.contentWindow as any,
    });
    window.dispatchEvent(event);
    await Promise.resolve();
    await Promise.resolve();

    expect(iframeReadyAck).toHaveBeenCalledWith('ext.a', 3, 'worker');
  });

  it('hard-errors and skips ack when payload.role is absent', async () => {
    const iframe = makeIframe('ext.a', '7');
    vi.mocked(iframeReadyAck).mockResolvedValueOnce([]);

    const event = new MessageEvent('message', {
      data: { type: 'asyar:extension:loaded', extensionId: 'ext.a' },
      source: iframe.contentWindow as any,
    });
    window.dispatchEvent(event);
    await Promise.resolve();
    await Promise.resolve();

    expect(iframeReadyAck).not.toHaveBeenCalled();
    expect(logService.error).toHaveBeenCalled();
  });

  it('hard-errors and skips ack when payload.role is unknown', async () => {
    const iframe = makeIframe('ext.a', '7');
    vi.mocked(iframeReadyAck).mockResolvedValueOnce([]);

    const event = new MessageEvent('message', {
      data: { type: 'asyar:extension:loaded', extensionId: 'ext.a', role: 'garbage' },
      source: iframe.contentWindow as any,
    });
    window.dispatchEvent(event);
    await Promise.resolve();
    await Promise.resolve();

    expect(iframeReadyAck).not.toHaveBeenCalled();
    expect(logService.error).toHaveBeenCalled();
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
      data: { type: 'asyar:extension:loaded', extensionId: 'ext.a', role: 'view' },
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
