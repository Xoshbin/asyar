/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/extensionLifecycleCommands', () => ({
  stateGet: vi.fn(),
  stateSet: vi.fn(),
  stateSubscribe: vi.fn(),
  stateUnsubscribe: vi.fn(),
  stateRpcRequest: vi.fn(),
  stateRpcAbort: vi.fn(),
  stateRpcReply: vi.fn(),
}));
vi.mock('../extension/extensionDelivery', () => ({ post: vi.fn() }));
vi.mock('../extension/workerHost.svelte', () => ({
  workerHost: { hasWorker: vi.fn(), deliver: vi.fn() },
}));
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { stateRpcRequest } from '../../lib/ipc/extensionLifecycleCommands';
import { post } from '../extension/extensionDelivery';
import { workerHost } from '../extension/workerHost.svelte';
import { logService } from '../log/logService';
import { extensionStateService } from './extensionStateService';

const readyDeliverNow = {
  kind: 'readyDeliverNow' as const,
  messages: [{ kind: 'command' as const, payload: { foo: 'bar' }, source: 'search' as const }],
};

describe('extensionStateService.rpcRequest ReadyDeliverNow routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.replaceChildren();
  });

  it('delivers via workerHost when a headless worker is registered, without touching the DOM', async () => {
    vi.mocked(workerHost.hasWorker).mockReturnValue(true);
    vi.mocked(stateRpcRequest).mockResolvedValueOnce(readyDeliverNow);

    await extensionStateService.rpcRequest('ext.a', 'status', 'corr-1', {});

    expect(workerHost.deliver).toHaveBeenCalledWith('ext.a', readyDeliverNow.messages[0]);
    expect(post).not.toHaveBeenCalled();
    expect(logService.warn).not.toHaveBeenCalled();
  });

  it('falls back to the worker iframe DOM node when no headless worker is registered', async () => {
    vi.mocked(workerHost.hasWorker).mockReturnValue(false);
    vi.mocked(stateRpcRequest).mockResolvedValueOnce(readyDeliverNow);

    const iframe = document.createElement('iframe');
    iframe.setAttribute('data-extension-id', 'ext.a');
    iframe.setAttribute('data-role', 'worker');
    document.body.appendChild(iframe);

    await extensionStateService.rpcRequest('ext.a', 'status', 'corr-1', {});

    expect(workerHost.deliver).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(iframe, readyDeliverNow.messages[0]);
  });

  it('warns and drops the message when neither a worker nor an iframe is available', async () => {
    vi.mocked(workerHost.hasWorker).mockReturnValue(false);
    vi.mocked(stateRpcRequest).mockResolvedValueOnce(readyDeliverNow);

    await extensionStateService.rpcRequest('ext.a', 'status', 'corr-1', {});

    expect(workerHost.deliver).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(logService.warn).toHaveBeenCalledWith(expect.stringContaining('message(s) dropped'));
  });
});
