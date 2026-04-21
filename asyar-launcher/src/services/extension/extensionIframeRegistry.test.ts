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
import { extensionIframeRegistry } from './extensionIframeRegistry.svelte';

describe('extensionIframeRegistry', () => {
  beforeEach(async () => {
    listeners.clear();
    vi.clearAllMocks();
    await extensionIframeRegistry.reset();
    await extensionIframeRegistry.init();
  });

  it('starts empty', () => {
    expect(extensionIframeRegistry.entries).toEqual([]);
  });

  it('adds an entry on asyar:iframe:mount with view role when absent', () => {
    listeners.get('asyar:iframe:mount')!({
      payload: { extensionId: 'ext.a', mountToken: 7 },
    });
    expect(extensionIframeRegistry.entries).toEqual([
      { extensionId: 'ext.a', mountToken: 7, role: 'view' },
    ]);
  });

  it('preserves worker role when present in payload', () => {
    listeners.get('asyar:iframe:mount')!({
      payload: { extensionId: 'ext.b', mountToken: 2, role: 'worker' },
    });
    expect(extensionIframeRegistry.entries[0].role).toBe('worker');
  });

  it('preserves view role when present in payload', () => {
    listeners.get('asyar:iframe:mount')!({
      payload: { extensionId: 'ext.c', mountToken: 3, role: 'view' },
    });
    expect(extensionIframeRegistry.entries[0].role).toBe('view');
  });

  it('defaults unknown role string to view', () => {
    listeners.get('asyar:iframe:mount')!({
      payload: { extensionId: 'ext.d', mountToken: 4, role: 'exotic' },
    });
    expect(extensionIframeRegistry.entries[0].role).toBe('view');
  });

  it('removes the entry on asyar:iframe:unmount and acks', async () => {
    listeners.get('asyar:iframe:mount')!({
      payload: { extensionId: 'ext.a', mountToken: 7, role: 'view' },
    });
    await listeners.get('asyar:iframe:unmount')!({
      payload: { extensionId: 'ext.a', reason: 'idle' },
    });
    expect(extensionIframeRegistry.entries).toEqual([]);
    expect(iframeUnmountAck).toHaveBeenCalledWith('ext.a');
  });

  it('ignores unmount for unknown extension but still sends ack', async () => {
    await listeners.get('asyar:iframe:unmount')!({
      payload: { extensionId: 'missing', reason: 'idle' },
    });
    expect(iframeUnmountAck).toHaveBeenCalledWith('missing');
  });
});
