import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockTauriListen, tauriListeners } = vi.hoisted(() => {
  const listeners = new Map<string, Set<(e: { payload: any }) => void>>();
  const mockListen = vi.fn(async (event: string, cb: (e: { payload: any }) => void) => {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(cb);
    return () => {
      set?.delete(cb);
    };
  });
  return { mockTauriListen: mockListen, tauriListeners: listeners };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: mockTauriListen,
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ label: 'main' }),
}));

import { invoke } from '@tauri-apps/api/core';
import {
  appListen,
  bridgeListen,
  startBridgeLoop,
  stopBridgeLoop,
  dispatchBridgeEvent,
  resetBridgeForTest,
} from './bridgeEvents';

describe('bridgeEvents transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauriListeners.clear();
    resetBridgeForTest?.();
  });

  describe('native subscription scope', () => {
    // Tauri delivers every `emit_to(<any label>)` to a listener registered with
    // the default `Any` target. `bridge_emit` fans out to non-poller windows via
    // `emit_to`, so an unscoped native listener in the poller window received
    // each event once per other open window on top of the queued delivery
    // (a silent agent hotkey fired 4x and cancelled itself).
    it("scopes the native listener to this webview so other windows' emit_to is not delivered", async () => {
      await appListen('test:scoped', vi.fn());

      expect(mockTauriListen).toHaveBeenCalledWith('test:scoped', expect.any(Function), {
        target: { kind: 'WebviewWindow', label: 'main' },
      });
    });
  });

  describe('registration & dispatch', () => {
    it('dispatches bridge events to registered listener', async () => {
      const handler = vi.fn();
      await appListen('test:event', handler);

      dispatchBridgeEvent('test:event', { foo: 'bar' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ payload: { foo: 'bar' } });
    });

    it('bridgeListen is an alias or unified with appListen', async () => {
      const handler = vi.fn();
      await bridgeListen('test:alias', handler);

      dispatchBridgeEvent('test:alias', { count: 42 });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ payload: { count: 42 } });
    });

    it('dispatches to multiple listeners registered for the same event', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      await appListen('multi:event', handler1);
      await appListen('multi:event', handler2);

      dispatchBridgeEvent('multi:event', { data: 'hello' });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler1).toHaveBeenCalledWith({ payload: { data: 'hello' } });
      expect(handler2).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledWith({ payload: { data: 'hello' } });
    });
  });

  describe('unlistening', () => {
    it('stops receiving events after unlistening', async () => {
      const handler = vi.fn();
      const unlisten = await appListen('unlisten:event', handler);

      dispatchBridgeEvent('unlisten:event', { seq: 1 });
      expect(handler).toHaveBeenCalledTimes(1);

      unlisten();

      dispatchBridgeEvent('unlisten:event', { seq: 2 });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('unlistening one handler does not affect other handlers on the same event', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const unlisten1 = await appListen('shared:event', handler1);
      await appListen('shared:event', handler2);

      unlisten1();

      dispatchBridgeEvent('shared:event', { val: 'test' });

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledWith({ payload: { val: 'test' } });
    });
  });

  describe('queue buffering before listener attachment', () => {
    it('buffers events that arrive before listener attachment and flushes on listen', async () => {
      dispatchBridgeEvent('buffered:event', { item: 1 });
      dispatchBridgeEvent('buffered:event', { item: 2 });

      const handler = vi.fn();
      await appListen('buffered:event', handler);

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenNthCalledWith(1, { payload: { item: 1 } });
      expect(handler).toHaveBeenNthCalledWith(2, { payload: { item: 2 } });
    });

    it('caps the buffer at PENDING_CAP (drops oldest)', async () => {
      for (let i = 0; i < 300; i++) {
        dispatchBridgeEvent('overflow:event', { index: i });
      }

      const handler = vi.fn();
      await appListen('overflow:event', handler);

      // PENDING_CAP is 256, so the oldest 44 (0..43) are dropped
      expect(handler).toHaveBeenCalledTimes(256);
      expect(handler).toHaveBeenNthCalledWith(1, { payload: { index: 44 } });
      expect(handler).toHaveBeenLastCalledWith({ payload: { index: 299 } });
    });
  });

  describe('error boundary isolation', () => {
    it('does not abort dispatch to other handlers if one handler throws', async () => {
      const faultyHandler = vi.fn(() => {
        throw new Error('Handler crash');
      });
      const safeHandler = vi.fn();

      await appListen('error:boundary', faultyHandler);
      await appListen('error:boundary', safeHandler);

      expect(() => {
        dispatchBridgeEvent('error:boundary', { ok: true });
      }).not.toThrow();

      expect(faultyHandler).toHaveBeenCalledTimes(1);
      expect(safeHandler).toHaveBeenCalledTimes(1);
      expect(safeHandler).toHaveBeenCalledWith({ payload: { ok: true } });
    });

    it('does not abort flushing buffered queue if one flush throws', async () => {
      dispatchBridgeEvent('flush:throw', { item: 1 });
      dispatchBridgeEvent('flush:throw', { item: 2 });

      let callCount = 0;
      const handler = vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Flush 1 failed');
        }
      });

      await expect(appListen('flush:throw', handler)).resolves.toBeDefined();
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('native Tauri listen fallback & unification', () => {
    it('receives events emitted via Tauri native emit', async () => {
      const handler = vi.fn();
      await appListen('native:event', handler);

      expect(mockTauriListen).toHaveBeenCalledWith(
        'native:event',
        expect.any(Function),
        expect.anything(),
      );

      // Simulate native Tauri event dispatch
      const tauriSet = tauriListeners.get('native:event');
      expect(tauriSet).toBeDefined();
      expect(tauriSet?.size).toBe(1);

      for (const cb of tauriSet!) {
        cb({ payload: { native: true } });
      }

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ payload: { native: true } });
    });

    it('unlisten also removes the native Tauri listener', async () => {
      const handler = vi.fn();
      const unlisten = await appListen('native:unsub', handler);

      const tauriSet = tauriListeners.get('native:unsub');
      expect(tauriSet?.size).toBe(1);

      unlisten();

      expect(tauriSet?.size).toBe(0);
    });
  });

  describe('startBridgeLoop', () => {
    it('polls bridge_poll and dispatches received events to listeners', async () => {
      const handler = vi.fn();
      await appListen('polled:event', handler);

      vi.mocked(invoke).mockImplementation(async () => {
        stopBridgeLoop();
        return [{ event: 'polled:event', payload: { polled: true } }];
      });

      startBridgeLoop();

      // Wait a microtask tick for loop execution
      await new Promise((r) => setTimeout(r, 10));

      expect(invoke).toHaveBeenCalledWith('bridge_poll');
      expect(handler).toHaveBeenCalledWith({ payload: { polled: true } });
    });
  });

  describe('non-poller window (settings, sticky, onboarding)', () => {
    it('receives a bridged event delivered natively via emit_to, without a bridge loop', async () => {
      // These windows never call startBridgeLoop(); the Rust bridge reaches
      // them with a targeted emit_to, which surfaces through Tauri's listen.
      const handler = vi.fn();
      await appListen('notes:changed', handler);

      for (const cb of tauriListeners.get('notes:changed') ?? []) {
        cb({ payload: { type: 'upsert', id: '1' } });
      }

      expect(invoke).not.toHaveBeenCalledWith('bridge_poll');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ payload: { type: 'upsert', id: '1' } });
    });
  });
});
