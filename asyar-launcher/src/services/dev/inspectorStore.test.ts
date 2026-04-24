/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock('../log/logService', () => ({
  logService: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    custom: vi.fn(),
  },
}));

// Note: the module reads `import.meta.env.DEV` at callsite. Vitest sets
// `DEV=true` in test mode, so start()/invoke paths are exercised live.

describe('inspectorStore', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('starts with isOpen=false, no selection, runtime tab default', async () => {
    const { inspectorStore } = await import('./inspectorStore.svelte');
    expect(inspectorStore.isOpen).toBe(false);
    expect(inspectorStore.selectedExtensionId).toBeNull();
    expect(inspectorStore.activeTab).toBe('runtime');
    expect(inspectorStore.runtimeMap).toEqual({});
  });

  it('toggle flips isOpen', async () => {
    const { inspectorStore } = await import('./inspectorStore.svelte');
    inspectorStore.toggle();
    expect(inspectorStore.isOpen).toBe(true);
    inspectorStore.toggle();
    expect(inspectorStore.isOpen).toBe(false);
  });

  it('selectExtension sets the id', async () => {
    const { inspectorStore } = await import('./inspectorStore.svelte');
    inspectorStore.selectExtension('ext.a');
    expect(inspectorStore.selectedExtensionId).toBe('ext.a');
    inspectorStore.selectExtension(null);
    expect(inspectorStore.selectedExtensionId).toBeNull();
  });

  it('entriesForSelected returns [] when nothing selected', async () => {
    const { inspectorStore } = await import('./inspectorStore.svelte');
    inspectorStore.selectExtension(null);
    expect(inspectorStore.entriesForSelected()).toEqual([]);
  });

  it('refreshRuntimeSnapshot merges Rust rows into runtimeMap', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockResolvedValueOnce([
      { extension_id: 'ext.a', role: 'worker', state: 'ready', mailbox_len: 2 },
      { extension_id: 'ext.a', role: 'view', state: 'dormant', mailbox_len: 0 },
    ]);
    const { inspectorStore } = await import('./inspectorStore.svelte');
    await inspectorStore.refreshRuntimeSnapshot();
    expect(inspectorStore.runtimeMap['ext.a:worker']).toMatchObject({
      extensionId: 'ext.a',
      role: 'worker',
      state: 'ready',
      mailboxLen: 2,
    });
    expect(inspectorStore.runtimeMap['ext.a:view']).toMatchObject({
      state: 'dormant',
      mailboxLen: 0,
    });
  });

  it('refreshRuntimeSnapshot coerces unknown state strings to "unknown"', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockResolvedValueOnce([
      { extension_id: 'ext.a', role: 'worker', state: 'weird-state', mailbox_len: 0 },
    ]);
    const { inspectorStore } = await import('./inspectorStore.svelte');
    await inspectorStore.refreshRuntimeSnapshot();
    expect(inspectorStore.runtimeMap['ext.a:worker'].state).toBe('unknown');
  });

  it('entriesForSelected filters to the selected extension id', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockResolvedValueOnce([
      { extension_id: 'ext.a', role: 'worker', state: 'ready', mailbox_len: 0 },
      { extension_id: 'ext.b', role: 'worker', state: 'ready', mailbox_len: 0 },
    ]);
    const { inspectorStore } = await import('./inspectorStore.svelte');
    await inspectorStore.refreshRuntimeSnapshot();
    inspectorStore.selectExtension('ext.a');
    const entries = inspectorStore.entriesForSelected();
    expect(entries.length).toBe(1);
    expect(entries[0].extensionId).toBe('ext.a');
  });

  it('refreshRuntimeSnapshot preserves prior mountToken/strikes when the row does not re-assert them', async () => {
    // First snapshot seeds nothing; a mount event would normally bring mountToken
    // in, then a later snapshot poll must not clobber that field.
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke)
      .mockResolvedValueOnce([
        { extension_id: 'ext.a', role: 'worker', state: 'mounting', mailbox_len: 0 },
      ])
      .mockResolvedValueOnce([
        { extension_id: 'ext.a', role: 'worker', state: 'ready', mailbox_len: 0 },
      ]);
    const { inspectorStore } = await import('./inspectorStore.svelte');
    await inspectorStore.refreshRuntimeSnapshot();
    // Simulate a mount-event patch that happens between polls.
    inspectorStore.runtimeMap = {
      ...inspectorStore.runtimeMap,
      'ext.a:worker': {
        ...inspectorStore.runtimeMap['ext.a:worker'],
        mountToken: 42,
      },
    };
    await inspectorStore.refreshRuntimeSnapshot();
    expect(inspectorStore.runtimeMap['ext.a:worker'].state).toBe('ready');
    expect(inspectorStore.runtimeMap['ext.a:worker'].mountToken).toBe(42);
  });

  it('forceRemountWorker invokes force_remount_worker with hasBackgroundMain', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockResolvedValue(undefined);
    const { inspectorStore } = await import('./inspectorStore.svelte');
    await inspectorStore.forceRemountWorker('ext.a');
    expect(invoke).toHaveBeenCalledWith('force_remount_worker', {
      extensionId: 'ext.a',
      hasBackgroundMain: expect.any(Boolean),
    });
  });

  it('refreshState stores rows keyed by extension id', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockResolvedValueOnce([
      { key: 'timer', value: { secs: 5 }, updatedAt: 1000 },
      { key: 'count', value: 42, updatedAt: 2000 },
    ]);
    const { inspectorStore } = await import('./inspectorStore.svelte');
    await inspectorStore.refreshState('ext.a');
    expect(inspectorStore.stateByExt['ext.a']).toHaveLength(2);
    expect(inspectorStore.stateByExt['ext.a'][0]).toMatchObject({
      key: 'timer',
      value: { secs: 5 },
      updatedAt: 1000,
    });
  });

  it('recordEvent appends to the per-extension ring buffer', async () => {
    const { inspectorStore } = await import('./inspectorStore.svelte');
    inspectorStore.recordEvent('asyar:iframe:mount', { extensionId: 'ext.a', mountToken: 1 });
    inspectorStore.recordEvent('asyar:state-changed', { extensionId: 'ext.a', key: 'k' });
    expect(inspectorStore.eventsByExt['ext.a']).toHaveLength(2);
    expect(inspectorStore.eventsByExt['ext.a'][0].eventName).toBe('asyar:iframe:mount');
    expect(inspectorStore.eventsByExt['ext.a'][1].eventName).toBe('asyar:state-changed');
  });

  it('recordEvent skips payloads without an extensionId', async () => {
    const { inspectorStore } = await import('./inspectorStore.svelte');
    inspectorStore.recordEvent('asyar:extension-update:tick', {});
    inspectorStore.recordEvent('asyar:misc', null);
    inspectorStore.recordEvent('asyar:misc2', 42);
    // No per-extension rows should exist from these calls.
    expect(Object.values(inspectorStore.eventsByExt).flat()).toHaveLength(0);
  });

  it('recordEvent separates events by extension', async () => {
    const { inspectorStore } = await import('./inspectorStore.svelte');
    inspectorStore.recordEvent('asyar:iframe:mount', { extensionId: 'ext.a' });
    inspectorStore.recordEvent('asyar:iframe:mount', { extensionId: 'ext.b' });
    expect(inspectorStore.eventsByExt['ext.a']).toHaveLength(1);
    expect(inspectorStore.eventsByExt['ext.b']).toHaveLength(1);
  });

  it('ring buffer caps at 250 entries per extension and drops oldest', async () => {
    const { inspectorStore } = await import('./inspectorStore.svelte');
    for (let i = 0; i < 300; i++) {
      inspectorStore.recordEvent('asyar:state-changed', {
        extensionId: 'ext.ring',
        key: `k${i}`,
      });
    }
    const rows = inspectorStore.eventsByExt['ext.ring'];
    expect(rows).toHaveLength(250);
    // Oldest dropped: the first 50 should be gone. The earliest remaining
    // entry's payload must reference k50 (the 51st call).
    const firstPayload = rows[0].payload as { key: string };
    expect(firstPayload.key).toBe('k50');
    const lastPayload = rows[rows.length - 1].payload as { key: string };
    expect(lastPayload.key).toBe('k299');
  });

  it('clearEvents drops all events for an extension', async () => {
    const { inspectorStore } = await import('./inspectorStore.svelte');
    inspectorStore.recordEvent('asyar:iframe:mount', { extensionId: 'ext.c' });
    inspectorStore.recordEvent('asyar:iframe:mount', { extensionId: 'ext.d' });
    inspectorStore.clearEvents('ext.c');
    expect(inspectorStore.eventsByExt['ext.c']).toBeUndefined();
    expect(inspectorStore.eventsByExt['ext.d']).toHaveLength(1);
  });

  it('recordEvent accepts snake_case extension_id from Rust-shaped payloads', async () => {
    const { inspectorStore } = await import('./inspectorStore.svelte');
    inspectorStore.recordEvent('asyar:state-changed', {
      extension_id: 'ext.snake',
      key: 'timer',
    });
    expect(inspectorStore.eventsByExt['ext.snake']).toHaveLength(1);
  });

  it('recordRpcLog aggregates request→resolved on the same correlationId', async () => {
    const { inspectorStore } = await import('./inspectorStore.svelte');
    inspectorStore.recordRpcLog('ext.a', {
      phase: 'request',
      id: 'doThing',
      correlationId: 'cor-1',
      payload: { x: 1 },
      timeoutMs: 5000,
      timestamp: 1000,
    });
    inspectorStore.recordRpcLog('ext.a', {
      phase: 'resolved',
      id: 'doThing',
      correlationId: 'cor-1',
      result: { ok: true },
      elapsedMs: 42,
      timestamp: 1042,
    });
    const trace = inspectorStore.rpcByExt['ext.a']['cor-1'];
    expect(trace.phase).toBe('resolved');
    expect(trace.id).toBe('doThing');
    expect(trace.payload).toEqual({ x: 1 }); // preserved from request phase
    expect(trace.result).toEqual({ ok: true });
    expect(trace.elapsedMs).toBe(42);
  });

  it('recordRpcLog preserves in-flight rows when the ring cap is hit', async () => {
    const { inspectorStore } = await import('./inspectorStore.svelte');
    // Emit 251 settled RPCs + 1 still-in-flight. The in-flight row must
    // survive the cap — dev inspector is observational, we cannot silently
    // drop a pending request.
    for (let i = 0; i < 251; i++) {
      inspectorStore.recordRpcLog('ext.ring', {
        phase: 'resolved',
        correlationId: `settled-${i}`,
        elapsedMs: 1,
        timestamp: 1000 + i,
      });
    }
    inspectorStore.recordRpcLog('ext.ring', {
      phase: 'request',
      correlationId: 'in-flight',
      timestamp: 9999,
    });
    const bucket = inspectorStore.rpcByExt['ext.ring'];
    expect(bucket['in-flight'].phase).toBe('request');
  });

  it('recordIpcLog appends to per-extension ring, capped at 250', async () => {
    const { inspectorStore } = await import('./inspectorStore.svelte');
    for (let i = 0; i < 300; i++) {
      inspectorStore.recordIpcLog('ext.ipc', {
        phase: 'invoke',
        command: `cmd-${i}`,
        messageId: `m-${i}`,
        timestamp: 1000 + i,
      });
    }
    const rows = inspectorStore.ipcByExt['ext.ipc'];
    expect(rows).toHaveLength(250);
    expect(rows[0].command).toBe('cmd-50');
    expect(rows[rows.length - 1].command).toBe('cmd-299');
  });

  it('clearRpc drops all traces for an extension; other extensions untouched', async () => {
    const { inspectorStore } = await import('./inspectorStore.svelte');
    inspectorStore.recordRpcLog('ext.x', {
      phase: 'request',
      correlationId: 'c1',
      timestamp: 1,
    });
    inspectorStore.recordRpcLog('ext.y', {
      phase: 'request',
      correlationId: 'c2',
      timestamp: 1,
    });
    inspectorStore.clearRpc('ext.x');
    expect(inspectorStore.rpcByExt['ext.x']).toBeUndefined();
    expect(inspectorStore.rpcByExt['ext.y']).toBeDefined();
  });

  it('refreshSubscriptions stores subscription summaries keyed by extension', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockResolvedValueOnce([
      { key: 'timer', role: 'worker', installedAt: 100, listenerCount: 3 },
      { key: 'timer', role: 'view', installedAt: 200, listenerCount: 1 },
    ]);
    const { inspectorStore } = await import('./inspectorStore.svelte');
    await inspectorStore.refreshSubscriptions('ext.a');
    expect(inspectorStore.subsByExt['ext.a']).toHaveLength(2);
    expect(inspectorStore.subsByExt['ext.a'][0]).toMatchObject({
      key: 'timer',
      role: 'worker',
      listenerCount: 3,
    });
  });
});
