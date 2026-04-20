import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

vi.mock('../log/logService', () => ({
  logService: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Controllable stub for settingsService.subscribe — tests capture the
// subscriber callback and drive it manually with new settings shapes.
let subscribedCallbacks: Array<(s: any) => void> = [];
const settingsStateHolder = {
  current: {
    search: {
      additionalScanPaths: [] as string[],
    },
  },
};

vi.mock('../settings/settingsService.svelte', () => ({
  settingsService: {
    get currentSettings() {
      return settingsStateHolder.current;
    },
    subscribe(cb: (s: any) => void) {
      subscribedCallbacks.push(cb);
      return () => {
        subscribedCallbacks = subscribedCallbacks.filter((f) => f !== cb);
      };
    },
  },
}));

import { invoke } from '@tauri-apps/api/core';
import { initScanPathsSync, __resetScanPathsSyncForTest } from './scanPathsSync.svelte';

async function flush(): Promise<void> {
  // Let microtasks drain so the fire-and-forget `invoke` call resolves.
  await Promise.resolve();
  await Promise.resolve();
}

describe('scanPathsSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscribedCallbacks = [];
    settingsStateHolder.current = {
      search: { additionalScanPaths: [] },
    };
    __resetScanPathsSyncForTest();
  });

  afterEach(() => {
    __resetScanPathsSyncForTest();
  });

  it('pushes initial additionalScanPaths to Rust on init', async () => {
    settingsStateHolder.current = {
      search: { additionalScanPaths: ['/opt/apps', '/Users/me/apps'] },
    };
    vi.mocked(invoke).mockResolvedValue(undefined);

    initScanPathsSync();
    await flush();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('set_application_scan_paths', {
      paths: ['/opt/apps', '/Users/me/apps'],
    });
  });

  it('pushes empty array when no paths are configured', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    initScanPathsSync();
    await flush();

    expect(invoke).toHaveBeenCalledWith('set_application_scan_paths', {
      paths: [],
    });
  });

  it('re-pushes on change when paths differ', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    initScanPathsSync();
    await flush();
    expect(invoke).toHaveBeenCalledTimes(1);

    subscribedCallbacks.forEach((cb) =>
      cb({ search: { additionalScanPaths: ['/new/path'] } }),
    );
    await flush();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenNthCalledWith(2, 'set_application_scan_paths', {
      paths: ['/new/path'],
    });
  });

  it('suppresses re-push when paths are identical', async () => {
    settingsStateHolder.current = {
      search: { additionalScanPaths: ['/opt'] },
    };
    vi.mocked(invoke).mockResolvedValue(undefined);

    initScanPathsSync();
    await flush();
    expect(invoke).toHaveBeenCalledTimes(1);

    // Same value, different array identity — must not trigger another push.
    subscribedCallbacks.forEach((cb) =>
      cb({ search: { additionalScanPaths: ['/opt'] } }),
    );
    await flush();

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('treats order change as a real change', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    settingsStateHolder.current = {
      search: { additionalScanPaths: ['/a', '/b'] },
    };

    initScanPathsSync();
    await flush();
    expect(invoke).toHaveBeenCalledTimes(1);

    subscribedCallbacks.forEach((cb) =>
      cb({ search: { additionalScanPaths: ['/b', '/a'] } }),
    );
    await flush();

    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('re-init replaces the previous subscription', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    initScanPathsSync();
    await flush();
    expect(subscribedCallbacks.length).toBe(1);

    initScanPathsSync();
    await flush();
    expect(subscribedCallbacks.length).toBe(1);
  });

  it('swallows invoke errors (logs warn) without throwing', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('rust not ready'));

    expect(() => initScanPathsSync()).not.toThrow();
    await flush();
    // Nothing to assert on invoke count beyond "it was called"; the
    // rejection is handled and does not crash the subscriber chain.
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
