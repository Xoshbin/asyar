import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
import { invoke } from '@tauri-apps/api/core';

import {
  dispatchToExtension,
  iframeReadyAck,
  iframeUnmountAck,
  iframeMountTimeoutReported,
  getIframeLifecycleSnapshot,
  type IpcPendingMessage,
  type IpcDispatchOutcome,
} from './iframeLifecycleCommands';

describe('iframeLifecycleCommands', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dispatchToExtension forwards arguments with camelCase keys', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ kind: 'mountingWaitForReady' });
    const msg: IpcPendingMessage = {
      kind: 'command',
      payload: { commandId: 'x' },
      source: 'search',
    };
    const res = await dispatchToExtension('ext.a', msg);
    expect(invoke).toHaveBeenCalledWith('dispatch_to_extension', {
      extensionId: 'ext.a',
      message: msg,
    });
    expect(res).toEqual<IpcDispatchOutcome>({ kind: 'mountingWaitForReady' });
  });

  it('iframeReadyAck returns drained messages', async () => {
    const drained: IpcPendingMessage[] = [
      { kind: 'command', payload: { commandId: 'x' }, source: 'search' },
    ];
    vi.mocked(invoke).mockResolvedValueOnce(drained);
    const res = await iframeReadyAck('ext.a', 7);
    expect(invoke).toHaveBeenCalledWith('iframe_ready_ack', {
      extensionId: 'ext.a',
      mountToken: 7,
    });
    expect(res).toEqual(drained);
  });

  it('iframeUnmountAck wraps iframe_unmount_ack', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await iframeUnmountAck('ext.a');
    expect(invoke).toHaveBeenCalledWith('iframe_unmount_ack', {
      extensionId: 'ext.a',
    });
  });

  it('iframeMountTimeoutReported wraps iframe_mount_timeout_reported', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await iframeMountTimeoutReported('ext.a', 7);
    expect(invoke).toHaveBeenCalledWith('iframe_mount_timeout_reported', {
      extensionId: 'ext.a',
      mountToken: 7,
    });
  });

  it('getIframeLifecycleSnapshot returns the array verbatim', async () => {
    const snap = [{ extensionId: 'ext.a', state: 'ready', mailboxLen: 0 }];
    vi.mocked(invoke).mockResolvedValueOnce(snap);
    const res = await getIframeLifecycleSnapshot();
    expect(res).toEqual(snap);
  });
});
