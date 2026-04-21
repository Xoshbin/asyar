/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const listeners = new Map<string, (e: { payload: any }) => void>();
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, handler: (e: { payload: any }) => void) => {
    listeners.set(event, handler);
    return () => listeners.delete(event);
  }),
}));
vi.mock('../../lib/ipc/iframeLifecycleCommands', () => ({
  iframeUnmountAck: vi.fn(),
}));
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { iframeUnmountAck } from '../../lib/ipc/iframeLifecycleCommands';
import { workerRegistry } from './workerRegistry.svelte';

describe('workerRegistry', () => {
  beforeEach(async () => {
    listeners.clear();
    vi.clearAllMocks();
    await workerRegistry.reset();
    await workerRegistry.init();
  });

  it('starts empty', () => {
    expect(workerRegistry.entries).toEqual([]);
  });

  it('adds a worker entry on handleMount with role=worker', () => {
    workerRegistry.handleMount({ extensionId: 'ext.a', mountToken: 7, role: 'worker' });
    expect(workerRegistry.entries).toEqual([{ extensionId: 'ext.a', mountToken: 7 }]);
  });

  it('ignores handleMount with role=view', () => {
    workerRegistry.handleMount({ extensionId: 'ext.a', mountToken: 7, role: 'view' });
    expect(workerRegistry.entries).toEqual([]);
  });

  it('ignores handleMount with absent role', () => {
    workerRegistry.handleMount({ extensionId: 'ext.a', mountToken: 7 });
    expect(workerRegistry.entries).toEqual([]);
  });

  it('updates mount token in-place on re-mount', () => {
    workerRegistry.handleMount({ extensionId: 'ext.a', mountToken: 1, role: 'worker' });
    workerRegistry.handleMount({ extensionId: 'ext.a', mountToken: 2, role: 'worker' });
    expect(workerRegistry.entries).toHaveLength(1);
    expect(workerRegistry.entries[0].mountToken).toBe(2);
  });

  it('removes entry on unmount and acks with role=worker', async () => {
    workerRegistry.handleMount({ extensionId: 'ext.a', mountToken: 7, role: 'worker' });
    await workerRegistry.handleUnmount({ extensionId: 'ext.a', reason: 'idle' });
    expect(workerRegistry.entries).toEqual([]);
    expect(iframeUnmountAck).toHaveBeenCalledWith('ext.a', 'worker');
  });

  it('getEntry returns the entry for a registered extension', () => {
    workerRegistry.handleMount({ extensionId: 'ext.a', mountToken: 5, role: 'worker' });
    expect(workerRegistry.getEntry('ext.a')).toEqual({ extensionId: 'ext.a', mountToken: 5 });
  });

  it('getEntry returns undefined for unknown extension', () => {
    expect(workerRegistry.getEntry('ext.unknown')).toBeUndefined();
  });

  it('asyar:iframe:mount event with role=worker adds to registry', () => {
    listeners.get('asyar:iframe:mount')?.({
      payload: { extensionId: 'ext.b', mountToken: 3, role: 'worker' },
    });
    expect(workerRegistry.entries).toHaveLength(1);
    expect(workerRegistry.entries[0].extensionId).toBe('ext.b');
  });

  it('asyar:iframe:mount event with role=view does not add to worker registry', () => {
    listeners.get('asyar:iframe:mount')?.({
      payload: { extensionId: 'ext.b', mountToken: 3, role: 'view' },
    });
    expect(workerRegistry.entries).toHaveLength(0);
  });
});
