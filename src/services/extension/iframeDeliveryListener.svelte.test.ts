/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const listeners = new Map<string, (e: { payload: unknown }) => void>();

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, cb: (e: { payload: unknown }) => void) => {
    listeners.set(event, cb);
    return () => listeners.delete(event);
  }),
}));

const postSpy = vi.fn();
vi.mock('./extensionDelivery', () => ({
  post: (iframe: HTMLIFrameElement, m: unknown) => postSpy(iframe, m),
}));

vi.mock('../diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: {
    report: vi.fn(),
    registerRetry: vi.fn(() => 'retry-x'),
  },
}));

import { iframeDeliveryListener } from './iframeDeliveryListener.svelte';
import { diagnosticsService } from '../diagnostics/diagnosticsService.svelte';

function makeIframe(extensionId: string, role: string, id: string): HTMLIFrameElement {
  const el = document.createElement('iframe');
  el.setAttribute('data-extension-id', extensionId);
  el.setAttribute('data-role', role);
  el.id = id;
  document.body.appendChild(el);
  return el;
}

describe('iframeDeliveryListener', () => {
  beforeEach(() => {
    listeners.clear();
    postSpy.mockClear();
    vi.mocked(diagnosticsService.report).mockClear();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    iframeDeliveryListener.reset();
  });

  it('posts each message to the iframe matching extensionId + role on EVENT_DELIVER', async () => {
    makeIframe('org.asyar.sdk-playground', 'view', 'v');
    makeIframe('org.asyar.sdk-playground', 'worker', 'w');
    makeIframe('org.other', 'worker', 'o');
    await iframeDeliveryListener.init();

    const handler = listeners.get('asyar:iframe:deliver');
    expect(handler, 'listener must subscribe to asyar:iframe:deliver').toBeDefined();

    const m1 = { kind: 'command', payload: { commandId: 'tick-test' }, source: 'schedule' };
    const m2 = { kind: 'command', payload: { commandId: 'tick-test', args: { scheduledTick: true } }, source: 'schedule' };
    handler!({
      payload: {
        extensionId: 'org.asyar.sdk-playground',
        role: 'worker',
        messages: [m1, m2],
      },
    });

    expect(postSpy).toHaveBeenCalledTimes(2);
    expect((postSpy.mock.calls[0][0] as HTMLIFrameElement).id).toBe('w');
    expect((postSpy.mock.calls[1][0] as HTMLIFrameElement).id).toBe('w');
    expect(postSpy.mock.calls[0][1]).toEqual(m1);
    expect(postSpy.mock.calls[1][1]).toEqual(m2);
  });

  it('reports a warning diagnostic and skips post when the iframe is missing', async () => {
    // no iframes in DOM
    await iframeDeliveryListener.init();
    const handler = listeners.get('asyar:iframe:deliver')!;
    handler({
      payload: {
        extensionId: 'org.absent',
        role: 'worker',
        messages: [
          { kind: 'command', payload: {}, source: 'schedule' },
          { kind: 'command', payload: {}, source: 'schedule' },
        ],
      },
    });
    expect(postSpy).not.toHaveBeenCalled();
    expect(diagnosticsService.report).toHaveBeenCalledTimes(1);
    expect(diagnosticsService.report).toHaveBeenCalledWith({
      source: 'frontend',
      kind: 'extension-runtime/scheduler-deliver-no-iframe',
      severity: 'warning',
      retryable: false,
      developerDetail: 'no iframe for org.absent role=worker; dropping 2 message(s)',
      context: { extensionId: 'org.absent', role: 'worker', messageCount: '2' },
    });
  });
});
