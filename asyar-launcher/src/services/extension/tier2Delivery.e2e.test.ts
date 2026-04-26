/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('../../lib/ipc/extensionOrigin', () => ({
  getExtensionFrameOrigin: (id: string) => `asyar-extension://${id}`,
}));
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { invoke } from '@tauri-apps/api/core';
import { dispatch } from './extensionDispatcher.svelte';

function makeIframe(id: string, token: string, role: 'view' | 'worker' = 'view') {
  document.body.replaceChildren();
  const iframe = document.createElement('iframe');
  iframe.setAttribute('data-extension-id', id);
  iframe.setAttribute('data-mount-token', token);
  iframe.setAttribute('data-role', role);
  const postMessage = vi.fn();
  Object.defineProperty(iframe, 'contentWindow', {
    value: { postMessage },
    configurable: true,
  });
  document.body.appendChild(iframe);
  return postMessage;
}

describe('Tier 2 delivery — end-to-end per trigger', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['search',       { kind: 'command', payload: { commandId: 'run' } }],
    ['argument',     { kind: 'command', payload: { commandId: 'run', args: { q: 1 } } }],
    ['timer',        { kind: 'command', payload: { commandId: 'fire', args: {} } }],
    ['schedule',     { kind: 'command', payload: { commandId: 'tick', args: {} } }],
    ['deeplink',     { kind: 'command', payload: { commandId: 'open', args: { id: 'x' } } }],
    ['notification', { kind: 'action',  payload: { actionId: 'snooze' } }],
    ['invoke',       { kind: 'command', payload: { commandId: 'cross', args: {} } }],
  ] as const)('source=%s → posts to iframe on Ready outcome', async (source, base) => {
    const postMessage = makeIframe('ext.a', '1');
    vi.mocked(invoke).mockResolvedValueOnce({
      kind: 'readyDeliverNow',
      messages: [{ ...base, source }],
    });

    await dispatch({
      extensionId: 'ext.a',
      kind: base.kind as any,
      payload: base.payload as any,
      source: source as any,
      commandMode: 'view',
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it('worker dispatch (commandMode=background) posts to data-role=worker iframe only', async () => {
    const postMessage = makeIframe('ext.a', '2', 'worker');
    vi.mocked(invoke).mockResolvedValueOnce({
      kind: 'readyDeliverNow',
      messages: [{ kind: 'command', payload: { commandId: 'fire', args: {} }, source: 'timer' }],
    });

    await dispatch({
      extensionId: 'ext.a',
      kind: 'command',
      payload: { commandId: 'fire', args: {} },
      source: 'timer',
      commandMode: 'background',
    } as any);

    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it('view dispatch (commandMode=view) does not post to data-role=worker iframe', async () => {
    const postMessage = makeIframe('ext.a', '1', 'worker');
    vi.mocked(invoke).mockResolvedValueOnce({
      kind: 'readyDeliverNow',
      messages: [{ kind: 'command', payload: { commandId: 'run' }, source: 'search' }],
    });

    await dispatch({
      extensionId: 'ext.a',
      kind: 'command',
      payload: { commandId: 'run' },
      source: 'search',
      commandMode: 'view',
    } as any);

    expect(postMessage).not.toHaveBeenCalled();
  });
});
