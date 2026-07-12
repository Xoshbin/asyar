import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mirrors extensionUpdateService.test.ts's mocking structure.
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(vi.fn()) }));
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/ipc/runtimeCommands', () => ({
  resolveRuntime: vi.fn(),
  ensureRuntime: vi.fn(),
  downloadRuntime: vi.fn(),
  listRuntimes: vi.fn(),
  removeRuntime: vi.fn(),
}));

describe('runtimeService', () => {
  let runtimeService: any;
  let listen: any;
  let runtimeCommands: any;

  beforeEach(async () => {
    vi.resetModules();
    ({ runtimeService } = await import('./runtimeService.svelte'));
    ({ listen } = await import('@tauri-apps/api/event'));
    runtimeCommands = await import('../../lib/ipc/runtimeCommands');
    vi.mocked(listen).mockClear();
    vi.mocked(listen).mockResolvedValue(vi.fn());
    Object.values(runtimeCommands).forEach((fn: any) => fn.mockClear?.());
  });

  it('init() subscribes to the runtime_download_progress event', async () => {
    await runtimeService.init();

    const listenCalls = vi.mocked(listen).mock.calls;
    const progressCall = listenCalls.find(
      ([eventName]: [string]) => eventName === 'runtime_download_progress',
    );
    expect(progressCall).toBeDefined();
  });

  it('resolve() invokes resolveRuntime with the runtime name and returns its result', async () => {
    vi.mocked(runtimeCommands.resolveRuntime).mockResolvedValueOnce(
      '/app-data/runtimes/bun/1.1.0/bun',
    );

    const path = await runtimeService.resolve('bun');

    expect(runtimeCommands.resolveRuntime).toHaveBeenCalledWith('bun');
    expect(path).toBe('/app-data/runtimes/bun/1.1.0/bun');
  });

  it('ensure() invokes ensureRuntime with the runtime name', async () => {
    vi.mocked(runtimeCommands.ensureRuntime).mockResolvedValueOnce({
      status: 'installed',
      path: '/app-data/runtimes/bun/1.1.0/bun',
    });

    await runtimeService.ensure('bun');

    expect(runtimeCommands.ensureRuntime).toHaveBeenCalledWith('bun');
  });

  it('download() invokes downloadRuntime with the runtime name', async () => {
    await runtimeService.download('bun');

    expect(runtimeCommands.downloadRuntime).toHaveBeenCalledWith('bun');
  });

  it('list() invokes listRuntimes', async () => {
    vi.mocked(runtimeCommands.listRuntimes).mockResolvedValueOnce([]);

    await runtimeService.list();

    expect(runtimeCommands.listRuntimes).toHaveBeenCalled();
  });

  it('remove() invokes removeRuntime with the runtime name', async () => {
    await runtimeService.remove('bun');

    expect(runtimeCommands.removeRuntime).toHaveBeenCalledWith('bun');
  });

  // One case per RuntimeDownloadProgress variant (camelCase per the
  // updater.rs UpdateProgress serde convention this type mirrors).
  const progressCases: Array<{ name: string; payload: unknown }> = [
    { name: 'resolving', payload: { status: 'resolving' } },
    {
      name: 'downloading',
      payload: { status: 'downloading', bytesDownloaded: 1024, totalBytes: 4096 },
    },
    { name: 'verifying', payload: { status: 'verifying' } },
    { name: 'extracting', payload: { status: 'extracting' } },
    { name: 'signing', payload: { status: 'signing' } },
    { name: 'ready', payload: { status: 'ready' } },
    { name: 'failed', payload: { status: 'failed', error: 'checksum mismatch' } },
  ];

  for (const { name, payload } of progressCases) {
    it(`a "${name}" runtime_download_progress event updates downloadProgress $state`, async () => {
      await runtimeService.init();

      const listenCalls = vi.mocked(listen).mock.calls;
      const [, handler] = listenCalls.find(
        ([eventName]: [string]) => eventName === 'runtime_download_progress',
      )!;

      handler({ payload });

      expect(runtimeService.downloadProgress).toEqual(payload);
    });
  }
});
