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
import { viewRegistry } from './viewRegistry.svelte';

describe('viewRegistry', () => {
  beforeEach(async () => {
    listeners.clear();
    vi.clearAllMocks();
    await viewRegistry.reset();
    await viewRegistry.init();
  });

  it('starts empty', () => {
    expect(viewRegistry.entries).toEqual([]);
  });

  it('adds a view entry on handleMount with role=view', () => {
    viewRegistry.handleMount({ extensionId: 'ext.a', mountToken: 7, role: 'view' });
    expect(viewRegistry.entries).toEqual([{ extensionId: 'ext.a', mountToken: 7 }]);
  });

  it('ignores handleMount with role=worker', () => {
    viewRegistry.handleMount({ extensionId: 'ext.a', mountToken: 7, role: 'worker' });
    expect(viewRegistry.entries).toEqual([]);
  });

  it('ignores handleMount with absent role', () => {
    viewRegistry.handleMount({ extensionId: 'ext.a', mountToken: 7 });
    expect(viewRegistry.entries).toEqual([]);
  });

  it('updates mount token in-place on re-mount', () => {
    viewRegistry.handleMount({ extensionId: 'ext.a', mountToken: 1, role: 'view' });
    viewRegistry.handleMount({ extensionId: 'ext.a', mountToken: 2, role: 'view' });
    expect(viewRegistry.entries).toHaveLength(1);
    expect(viewRegistry.entries[0].mountToken).toBe(2);
  });

  it('removes entry on unmount and acks with role=view', async () => {
    viewRegistry.handleMount({ extensionId: 'ext.a', mountToken: 7, role: 'view' });
    await viewRegistry.handleUnmount({ extensionId: 'ext.a', reason: 'idle', role: 'view' });
    expect(viewRegistry.entries).toEqual([]);
    expect(iframeUnmountAck).toHaveBeenCalledWith('ext.a', 'view');
  });

  it('handleUnmount with role=worker is a no-op (does not remove or ack)', async () => {
    viewRegistry.handleMount({ extensionId: 'ext.a', mountToken: 7, role: 'view' });
    await viewRegistry.handleUnmount({ extensionId: 'ext.a', reason: 'idle', role: 'worker' });
    expect(viewRegistry.entries).toEqual([{ extensionId: 'ext.a', mountToken: 7 }]);
    expect(iframeUnmountAck).not.toHaveBeenCalled();
  });

  it('getEntry returns the entry for a registered extension', () => {
    viewRegistry.handleMount({ extensionId: 'ext.a', mountToken: 5, role: 'view' });
    expect(viewRegistry.getEntry('ext.a')).toEqual({ extensionId: 'ext.a', mountToken: 5 });
  });

  it('getEntry returns undefined for unknown extension', () => {
    expect(viewRegistry.getEntry('ext.unknown')).toBeUndefined();
  });

  it('asyar:iframe:mount event with role=view adds to registry', () => {
    listeners.get('asyar:iframe:mount')?.({
      payload: { extensionId: 'ext.b', mountToken: 3, role: 'view' },
    });
    expect(viewRegistry.entries).toHaveLength(1);
    expect(viewRegistry.entries[0].extensionId).toBe('ext.b');
  });

  it('asyar:iframe:mount event with role=worker does not add to view registry', () => {
    listeners.get('asyar:iframe:mount')?.({
      payload: { extensionId: 'ext.b', mountToken: 3, role: 'worker' },
    });
    expect(viewRegistry.entries).toHaveLength(0);
  });
});
