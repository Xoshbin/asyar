/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/iframeLifecycleCommands', () => ({
  dispatchToExtension: vi.fn(),
}));
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('./extensionDelivery', () => ({ post: vi.fn() }));

import { dispatchToExtension } from '../../lib/ipc/iframeLifecycleCommands';
import { post } from './extensionDelivery';
import { logService } from '../log/logService';
import { dispatch } from './extensionDispatcher.svelte';

describe('extensionDispatcher.dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.replaceChildren();
  });

  it('on ReadyDeliverNow, posts each message via extensionDelivery.post', async () => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('data-extension-id', 'ext.a');
    iframe.setAttribute('data-role', 'view');
    document.body.appendChild(iframe);

    vi.mocked(dispatchToExtension).mockResolvedValueOnce({
      kind: 'readyDeliverNow',
      messages: [
        { kind: 'command', payload: { commandId: 'c1' }, source: 'search' },
      ],
    });

    await dispatch({
      extensionId: 'ext.a',
      kind: 'command',
      payload: { commandId: 'c1' },
      source: 'search',
      commandMode: 'view',
    });

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(iframe, expect.objectContaining({
      kind: 'command',
      payload: { commandId: 'c1' },
    }));
  });

  it('on MountingWaitForReady, does not call post', async () => {
    vi.mocked(dispatchToExtension).mockResolvedValueOnce({ kind: 'mountingWaitForReady' });
    await dispatch({ extensionId: 'ext.a', kind: 'command', payload: {}, source: 'search', commandMode: 'view' });
    expect(post).not.toHaveBeenCalled();
  });

  it('on NeedsMount, does not call post (mount event drives registry)', async () => {
    vi.mocked(dispatchToExtension).mockResolvedValueOnce({ kind: 'needsMount', mountToken: 5 });
    await dispatch({ extensionId: 'ext.a', kind: 'command', payload: {}, source: 'search', commandMode: 'view' });
    expect(post).not.toHaveBeenCalled();
  });

  it('on Degraded for user-facing source, logs warning and does not post', async () => {
    vi.mocked(dispatchToExtension).mockResolvedValueOnce({ kind: 'degraded', strikes: 3 });
    await dispatch({ extensionId: 'ext.a', kind: 'command', payload: {}, source: 'search', commandMode: 'view' });
    expect(post).not.toHaveBeenCalled();
    expect(logService.warn).toHaveBeenCalledWith(expect.stringContaining('degraded'));
  });

  it('on Degraded for background source, only logs', async () => {
    vi.mocked(dispatchToExtension).mockResolvedValueOnce({ kind: 'degraded', strikes: 3 });
    await dispatch({ extensionId: 'ext.a', kind: 'command', payload: {}, source: 'timer', commandMode: 'background' });
    expect(post).not.toHaveBeenCalled();
  });

  it('passes role=view to dispatchToExtension when commandMode is view', async () => {
    vi.mocked(dispatchToExtension).mockResolvedValueOnce({ kind: 'mountingWaitForReady' });
    await dispatch({
      extensionId: 'ext.a',
      kind: 'command',
      payload: {},
      source: 'search',
      commandMode: 'view',
    } as any);
    expect(dispatchToExtension).toHaveBeenCalledWith('ext.a', expect.any(Object), 'view');
  });

  it('passes role=worker to dispatchToExtension when commandMode is background', async () => {
    vi.mocked(dispatchToExtension).mockResolvedValueOnce({ kind: 'mountingWaitForReady' });
    await dispatch({
      extensionId: 'ext.a',
      kind: 'command',
      payload: {},
      source: 'timer',
      commandMode: 'background',
    } as any);
    expect(dispatchToExtension).toHaveBeenCalledWith('ext.a', expect.any(Object), 'worker');
  });

  it('ReadyDeliverNow posts to the iframe matching data-role', async () => {
    const viewIframe = document.createElement('iframe');
    viewIframe.setAttribute('data-extension-id', 'ext.a');
    viewIframe.setAttribute('data-role', 'view');
    const workerIframe = document.createElement('iframe');
    workerIframe.setAttribute('data-extension-id', 'ext.a');
    workerIframe.setAttribute('data-role', 'worker');
    document.body.appendChild(viewIframe);
    document.body.appendChild(workerIframe);

    vi.mocked(dispatchToExtension).mockResolvedValueOnce({
      kind: 'readyDeliverNow',
      messages: [{ kind: 'command', payload: {}, source: 'search' }],
    });

    await dispatch({
      extensionId: 'ext.a',
      kind: 'command',
      payload: {},
      source: 'search',
      commandMode: 'view',
    } as any);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(viewIframe, expect.any(Object));
  });
});
