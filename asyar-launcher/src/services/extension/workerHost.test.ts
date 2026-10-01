/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/ipc/iframeLifecycleCommands', () => ({
  iframeReadyAck: vi.fn(async () => []),
}));
vi.mock('../feedback/feedbackService.svelte', () => ({
  feedbackService: {
    report: vi.fn(async () => {}),
  },
}));
vi.mock('./extensionPendingState.svelte', () => ({
  extensionPendingState: {
    markReady: vi.fn(),
  },
}));
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { iframeReadyAck } from '../../lib/ipc/iframeLifecycleCommands';
import { feedbackService } from '../feedback/feedbackService.svelte';
import { extensionPendingState } from './extensionPendingState.svelte';
import { workerHost, setWorkerPreferenceProvider } from './workerHost.svelte';

describe('workerHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workerHost.reset();
  });

  afterEach(() => {
    workerHost.reset();
  });

  it('mounts a worker channel and updates activeWorkers and sourceMap', () => {
    expect(workerHost.hasWorker('ext.test')).toBe(false);

    workerHost.mount('ext.test', 1);

    expect(workerHost.hasWorker('ext.test')).toBe(true);
    const channel = workerHost.getWorker('ext.test');
    expect(channel).toBeDefined();
    expect(channel?.extensionId).toBe('ext.test');
    expect(channel?.mountToken).toBe(1);

    expect(workerHost.hasSource(channel)).toBe(true);
    expect(workerHost.findExtensionIdForSource(channel)).toBe('ext.test');
  });

  it('unmounts a worker channel and terminates it', () => {
    workerHost.mount('ext.test', 1);
    const channel = workerHost.getWorker('ext.test');
    const terminateSpy = vi.spyOn(channel!, 'terminate');

    workerHost.unmount('ext.test', 'user_close');

    expect(terminateSpy).toHaveBeenCalled();
    expect(workerHost.hasWorker('ext.test')).toBe(false);
    expect(workerHost.getWorker('ext.test')).toBeUndefined();
    expect(workerHost.hasSource(channel)).toBe(false);
  });

  it('remounts cleanly if mount is called for an already mounted worker', () => {
    workerHost.mount('ext.test', 1);
    const channel1 = workerHost.getWorker('ext.test');
    const terminateSpy1 = vi.spyOn(channel1!, 'terminate');

    workerHost.mount('ext.test', 2);
    expect(terminateSpy1).toHaveBeenCalled();

    const channel2 = workerHost.getWorker('ext.test');
    expect(channel2).toBeDefined();
    expect(channel2?.mountToken).toBe(2);
  });

  it('handles simulated worker readiness and drains pending messages', async () => {
    (iframeReadyAck as any).mockResolvedValueOnce([
      {
        kind: 'command',
        source: 'search',
        payload: { command: 'do_something' },
      },
    ]);

    workerHost.mount('ext.test', 1);
    const channel = workerHost.getWorker('ext.test');
    const postSpy = vi.spyOn(channel!, 'postMessage');

    // Wait for the microtask queued by HeadlessSimulatedWorker
    await new Promise((r) => setTimeout(r, 20));

    expect(iframeReadyAck).toHaveBeenCalledWith('ext.test', 1, 'worker');
    expect(extensionPendingState.markReady).toHaveBeenCalledWith('ext.test');
    expect(postSpy).toHaveBeenCalledWith({
      type: 'asyar:command:execute',
      payload: { command: 'do_something' },
    });
  });

  it('fetches initial preferences via preferenceProvider upon readiness', async () => {
    const mockProvider = vi.fn().mockResolvedValue({
      extension: { theme: 'dark' },
      commands: { 'cmd.search': { hotkey: 'cmd+k' } },
    });
    setWorkerPreferenceProvider(mockProvider);

    workerHost.mount('ext.prefs', 10);
    const channel = workerHost.getWorker('ext.prefs');
    const postSpy = vi.spyOn(channel!, 'postMessage');

    await new Promise((r) => setTimeout(r, 20));

    expect(mockProvider).toHaveBeenCalledWith('ext.prefs');
    expect(postSpy).toHaveBeenCalledWith({
      type: 'asyar:event:preferences:set-all',
      payload: {
        extension: { theme: 'dark' },
        commands: { 'cmd.search': { hotkey: 'cmd+k' } },
      },
    });
  });

  it('delivers wire messages and direct posts to the worker', () => {
    workerHost.mount('ext.test', 1);
    const channel = workerHost.getWorker('ext.test');
    const postSpy = vi.spyOn(channel!, 'postMessage');

    workerHost.post('ext.test', { type: 'custom:ping' });
    expect(postSpy).toHaveBeenCalledWith({ type: 'custom:ping' });

    workerHost.deliver('ext.test', {
      kind: 'action',
      source: 'search',
      payload: { action: 'refresh' },
    });
    expect(postSpy).toHaveBeenCalledWith({
      type: 'asyar:action:execute',
      payload: { action: 'refresh' },
    });
  });

  it('broadcasts preference changes to the worker', () => {
    workerHost.mount('ext.test', 1);
    const channel = workerHost.getWorker('ext.test');
    const postSpy = vi.spyOn(channel!, 'postMessage');

    workerHost.broadcastPreferences('ext.test', {
      extension: { active: true },
      commands: {},
    });

    expect(postSpy).toHaveBeenCalledWith({
      type: 'asyar:event:preferences:set-all',
      payload: {
        extension: { active: true },
        commands: {},
      },
    });
  });

  it('routes uncaught feedback errors to feedbackService', () => {
    workerHost.mount('ext.test', 1);
    const channel = workerHost.getWorker('ext.test') as any;

    channel.onHostMessage({
      type: 'asyar:feedback:uncaught',
      payload: {
        kind: 'worker_bootstrap_error',
        developerDetail: 'Failed to import worker script',
      },
    });

    expect(feedbackService.report).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'extension',
        kind: 'worker_bootstrap_error',
        developerDetail: 'Failed to import worker script',
        extensionId: 'ext.test',
      }),
    );
  });

  it('routes incoming worker IPC messages through setIpcHandler', async () => {
    const ipcHandler = vi.fn();
    workerHost.setIpcHandler(ipcHandler);

    workerHost.mount('ext.test', 1);
    const channel = workerHost.getWorker('ext.test') as any;

    channel.onHostMessage({
      type: 'asyar:rpc:request',
      id: 'req-1',
      method: 'clipboard.readText',
    });

    expect(ipcHandler).toHaveBeenCalledTimes(1);
    const event = ipcHandler.mock.calls[0][0];
    expect(event.data).toEqual({
      type: 'asyar:rpc:request',
      id: 'req-1',
      method: 'clipboard.readText',
    });
    expect(event.origin).toBe('asyar-extension://ext.test');
  });

  it('resets all workers on reset()', () => {
    workerHost.mount('ext.a', 1);
    workerHost.mount('ext.b', 2);
    expect(workerHost.hasWorker('ext.a')).toBe(true);
    expect(workerHost.hasWorker('ext.b')).toBe(true);

    workerHost.reset();

    expect(workerHost.hasWorker('ext.a')).toBe(false);
    expect(workerHost.hasWorker('ext.b')).toBe(false);
  });

  it('instantiates real Worker when Worker constructor is available', () => {
    const mockPostMessage = vi.fn();
    const mockTerminate = vi.fn();
    class MockWorker {
      postMessage = mockPostMessage;
      terminate = mockTerminate;
      onmessage: ((e: any) => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      constructor(
        public url: string,
        public options: any,
      ) {}
    }

    const originalWorker = globalThis.Worker;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;

    try {
      globalThis.Worker = MockWorker as any;
      URL.createObjectURL = vi.fn(() => 'blob:mock-url');
      URL.revokeObjectURL = vi.fn();

      workerHost.mount('ext.worker-real', 5);

      const channel = workerHost.getWorker('ext.worker-real');
      expect(channel).toBeDefined();
      expect(channel?.rawWorker).toBeDefined();
      expect(workerHost.hasSource(channel?.rawWorker)).toBe(true);
      expect(workerHost.findExtensionIdForSource(channel?.rawWorker)).toBe('ext.worker-real');

      channel?.postMessage({ ping: true });
      expect(mockPostMessage).toHaveBeenCalledWith({ ping: true });

      workerHost.unmount('ext.worker-real', 'done');
      expect(mockTerminate).toHaveBeenCalled();
    } finally {
      globalThis.Worker = originalWorker;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });
});
