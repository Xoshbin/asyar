import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── hoisted mocks (must come before any imports) ────────────────────────────

const mockLocalHandle = vi.hoisted(() => ({
  id: 'mock-run-id',
  write: vi.fn(async () => {}),
  done: vi.fn(async () => {}),
  fail: vi.fn(async () => {}),
  cancel: vi.fn(async () => {}),
  onCancel: vi.fn(() => () => {}),
}));

const mockRunService = vi.hoisted(() => ({
  startLocal: vi.fn<
    (input: { label: string; kind: string; cancellable?: boolean; extensionId?: string | null }) => Promise<typeof mockLocalHandle>
  >(async () => mockLocalHandle),
}));

vi.mock('../run/runService.svelte', () => ({
  runService: mockRunService,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock('./shellConsentService.svelte', () => ({
  shellConsentService: { requestConsent: vi.fn().mockResolvedValue(true) },
}));
vi.mock('../extension/streamDispatcher.svelte', () => ({
  streamDispatcher: {
    create: vi.fn().mockReturnValue({
      onAbort: vi.fn(),
      sendChunk: vi.fn(),
      sendDone: vi.fn(),
      sendError: vi.fn(),
    }),
    has: vi.fn().mockReturnValue(false),
    forward: vi.fn(),
    abort: vi.fn(),
  },
}));
vi.mock('../log/logService', () => ({
  logService: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn(), custom: vi.fn() },
}));

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { shellService } from './shellService.svelte';
import { shellConsentService } from './shellConsentService.svelte';
import { streamDispatcher } from '../extension/streamDispatcher.svelte';

describe('ShellService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shellConsentService.requestConsent).mockResolvedValue(true);
  });

  describe('spawn(extensionId, program, args, spawnId) — IPC router positional dispatch', () => {
    it('resolves the program path using shell_resolve_path', async () => {
      vi.mocked(invoke).mockImplementation((cmd) => {
        if (cmd === 'shell_resolve_path') return Promise.resolve('/usr/bin/echo');
        return Promise.resolve(undefined);
      });

      // Called with individual positional args (how the IPC router dispatches via Object.values)
      await shellService.spawn('org.asyar.sdk-playground', 'echo', ['Hello'], 'spawn-1');

      expect(invoke).toHaveBeenCalledWith('shell_resolve_path', { program: 'echo' });
    });

    it('passes the resolved path to the consent service', async () => {
      vi.mocked(invoke).mockImplementation((cmd) => {
        if (cmd === 'shell_resolve_path') return Promise.resolve('/usr/bin/echo');
        return Promise.resolve(undefined);
      });

      await shellService.spawn('org.asyar.sdk-playground', 'echo', ['Hello'], 'spawn-1');

      expect(shellConsentService.requestConsent).toHaveBeenCalledWith(
        'org.asyar.sdk-playground',
        'echo',
        '/usr/bin/echo',
      );
    });

    it('returns { streaming: true }', async () => {
      vi.mocked(invoke).mockImplementation((cmd) => {
        if (cmd === 'shell_resolve_path') return Promise.resolve('/usr/bin/echo');
        return Promise.resolve(undefined);
      });

      const result = await shellService.spawn('org.asyar.sdk-playground', 'echo', [], 'spawn-1');

      expect(result).toEqual({ streaming: true });
    });

    it('throws PERMISSION_DENIED when consent is denied', async () => {
      vi.mocked(invoke).mockResolvedValue('/usr/bin/echo');
      vi.mocked(shellConsentService.requestConsent).mockResolvedValue(false);

      await expect(
        shellService.spawn('org.asyar.sdk-playground', 'echo', [], 'spawn-1'),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('invokes shell_spawn with the resolved path, not the short name', async () => {
      vi.mocked(invoke).mockImplementation((cmd) => {
        if (cmd === 'shell_resolve_path') return Promise.resolve('/opt/homebrew/bin/git');
        return Promise.resolve(undefined);
      });

      await shellService.spawn('org.asyar.sdk-playground', 'git', ['status'], 'spawn-2');

      expect(invoke).toHaveBeenCalledWith('shell_spawn', expect.objectContaining({
        program: '/opt/homebrew/bin/git',
        args: ['status'],
        spawnId: 'spawn-2',
        extensionId: 'org.asyar.sdk-playground',
      }));
    });
  });

  describe('list(extensionId)', () => {
    it('invokes shell_list with the extensionId and returns the descriptors', async () => {
      const descriptors = [
        { spawnId: 's1', program: '/bin/echo', args: ['a'], pid: 100, startedAt: 1 },
      ];
      vi.mocked(invoke).mockImplementation((cmd) => {
        if (cmd === 'shell_list') return Promise.resolve(descriptors);
        return Promise.resolve(undefined);
      });

      const result = await shellService.list('org.asyar.sdk-playground');

      expect(invoke).toHaveBeenCalledWith('shell_list', {
        extensionId: 'org.asyar.sdk-playground',
      });
      expect(result).toEqual(descriptors);
    });
  });

  describe('attach(extensionId, spawnId)', () => {
    it('invokes shell_attach with the extensionId + spawnId and returns the descriptor', async () => {
      const descriptor = {
        spawnId: 'reattach-1',
        program: '/bin/sleep',
        args: ['60'],
        pid: 200,
        startedAt: 5,
      };
      vi.mocked(streamDispatcher.has).mockReturnValue(false);
      vi.mocked(invoke).mockImplementation((cmd) => {
        if (cmd === 'shell_attach') return Promise.resolve(descriptor);
        return Promise.resolve(undefined);
      });

      const result = await shellService.attach('org.asyar.sdk-playground', 'reattach-1');

      expect(invoke).toHaveBeenCalledWith('shell_attach', {
        extensionId: 'org.asyar.sdk-playground',
        spawnId: 'reattach-1',
      });
      expect(result).toEqual(descriptor);
    });

    it('creates a fresh streamDispatcher entry when no live one exists', async () => {
      vi.mocked(streamDispatcher.has).mockReturnValue(false);
      vi.mocked(invoke).mockResolvedValue({});

      await shellService.attach('ext-a', 'reattach-2');

      expect(streamDispatcher.create).toHaveBeenCalledWith('ext-a', 'reattach-2', undefined);
    });

    it('reuses the existing streamDispatcher entry when the spawn is still live', async () => {
      vi.mocked(streamDispatcher.has).mockReturnValue(true);
      vi.mocked(streamDispatcher.create).mockClear();
      vi.mocked(invoke).mockResolvedValue({});

      await shellService.attach('ext-a', 'live-stream');

      expect(streamDispatcher.create).not.toHaveBeenCalled();
    });
  });
});

// ── Run Tracker auto-promotion ─────────────────────────────────────────────────

/**
 * Helper: build a listen mock that records callbacks by event name so tests
 * can fire simulated Tauri events. Returns the map and a typed fire helper.
 *
 * The shell service installs global listeners for:
 *   asyar:shell:chunk  → { spawnId, stream, data }
 *   asyar:shell:done   → { spawnId, exitCode? }
 *   asyar:shell:error  → { spawnId, message }
 *
 * After the worker wires run-tracker promotion, it will also register
 * per-spawnId listeners (or equivalent hooks) for those same events.
 * These tests capture all registered callbacks and fire the relevant one.
 */
function makeListenCapture() {
  // event name → array of registered handlers
  const handlers: Record<string, Array<(event: { payload: unknown }) => void>> = {};

  const listenMock = vi.fn(
    async (
      eventName: string,
      handler: (event: { payload: unknown }) => void,
    ): Promise<() => void> => {
      if (!handlers[eventName]) handlers[eventName] = [];
      handlers[eventName].push(handler);
      return () => {
        handlers[eventName] = handlers[eventName].filter((h) => h !== handler);
      };
    },
  );

  function fire(eventName: string, payload: unknown) {
    for (const h of handlers[eventName] ?? []) {
      h({ payload });
    }
  }

  return { listenMock, fire };
}

describe('shellService.spawn run-tracker auto-promotion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shellConsentService.requestConsent).mockResolvedValue(true);
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === 'shell_resolve_path') return Promise.resolve('/usr/bin/echo');
      return Promise.resolve(undefined);
    });
    vi.mocked(streamDispatcher.create).mockReturnValue({
      onAbort: vi.fn(),
      sendChunk: vi.fn(),
      sendDone: vi.fn(),
      sendError: vi.fn(),
    } as any);
    mockRunService.startLocal.mockResolvedValue(mockLocalHandle);
    mockLocalHandle.write.mockReset();
    mockLocalHandle.done.mockReset();
    mockLocalHandle.fail.mockReset();
    mockLocalHandle.onCancel.mockReset();
    // Reset the singleton's global-listener guard so each test gets a clean slate
    (shellService as any).listenersReady = null;
  });

  it('spawn_calls_runService_startLocal_with_shell_script_kind', async () => {
    await shellService.spawn('org.asyar.ext-a', 'echo', ['hello'], 'spawn-rt-1');

    expect(mockRunService.startLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'shell-script',
        label: expect.stringContaining('echo'),
        extensionId: 'org.asyar.ext-a',
      }),
    );
    const callArg = mockRunService.startLocal.mock.calls[0][0];
    expect(callArg.label.length).toBeGreaterThan(0);
  });

  it('spawn_uses_explicit_label_when_provided', async () => {
    await shellService.spawn(
      'scripts',
      '/Users/me/scripts/sync-hosts.sh',
      [],
      'spawn-rt-label',
      undefined,
      'cmd_scripts_dyn_sync',
      'Sync Hosts',
    );

    expect(mockRunService.startLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Sync Hosts',
      }),
    );
  });

  it('spawn_forwards_stdout_lines_to_handle_write', async () => {
    const { listenMock, fire } = makeListenCapture();
    vi.mocked(listen).mockImplementation(listenMock as any);

    await shellService.spawn('org.asyar.ext-a', 'echo', ['hello'], 'spawn-rt-2');

    // Simulate 3 stdout chunk events for this spawnId
    fire('asyar:shell:chunk', { spawnId: 'spawn-rt-2', stream: 'stdout', data: 'line1\n' });
    fire('asyar:shell:chunk', { spawnId: 'spawn-rt-2', stream: 'stdout', data: 'line2\n' });
    fire('asyar:shell:chunk', { spawnId: 'spawn-rt-2', stream: 'stdout', data: 'line3\n' });

    // Allow any micro-task queued writes to flush
    await Promise.resolve();

    expect(mockLocalHandle.write).toHaveBeenCalledTimes(3);
    expect(mockLocalHandle.write).toHaveBeenNthCalledWith(1, 'line1\n');
    expect(mockLocalHandle.write).toHaveBeenNthCalledWith(2, 'line2\n');
    expect(mockLocalHandle.write).toHaveBeenNthCalledWith(3, 'line3\n');
  });

  it('spawn_calls_handle_done_on_zero_exit_code', async () => {
    const { listenMock, fire } = makeListenCapture();
    vi.mocked(listen).mockImplementation(listenMock as any);

    await shellService.spawn('org.asyar.ext-a', 'echo', ['hello'], 'spawn-rt-3');

    fire('asyar:shell:done', { spawnId: 'spawn-rt-3', exitCode: 0 });
    await Promise.resolve();

    expect(mockLocalHandle.done).toHaveBeenCalledOnce();
    expect(mockLocalHandle.fail).not.toHaveBeenCalled();
  });

  it('spawn_calls_handle_fail_on_nonzero_exit', async () => {
    const { listenMock, fire } = makeListenCapture();
    vi.mocked(listen).mockImplementation(listenMock as any);

    await shellService.spawn('org.asyar.ext-a', 'echo', ['hello'], 'spawn-rt-4');

    fire('asyar:shell:done', { spawnId: 'spawn-rt-4', exitCode: 1 });
    await Promise.resolve();

    expect(mockLocalHandle.fail).toHaveBeenCalledWith(expect.stringContaining('1'));
    expect(mockLocalHandle.done).not.toHaveBeenCalled();
  });
});
