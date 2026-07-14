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

let subscribedCallbacks: Array<(s: any) => void> = [];
const settingsStateHolder = {
  current: {
    fileSearch: {
      enabled: true,
      includeRoots: [] as string[],
      excludePatterns: [] as string[],
      indexHidden: false,
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
import {
  initFileIndexConfigSync,
  __resetFileIndexConfigSyncForTest,
} from './fileIndexConfigSync.svelte';

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function cfg(overrides: Partial<typeof settingsStateHolder.current.fileSearch> = {}) {
  return {
    enabled: true,
    includeRoots: [],
    excludePatterns: [],
    indexHidden: false,
    ...overrides,
  };
}

describe('fileIndexConfigSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscribedCallbacks = [];
    settingsStateHolder.current = { fileSearch: cfg() };
    __resetFileIndexConfigSyncForTest();
  });

  afterEach(() => {
    __resetFileIndexConfigSyncForTest();
  });

  it('pushes the initial config to Rust on init', async () => {
    settingsStateHolder.current = { fileSearch: cfg({ includeRoots: ['/data'] }) };
    vi.mocked(invoke).mockResolvedValue(undefined);

    initFileIndexConfigSync();
    await flush();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('file_index_set_config', {
      config: cfg({ includeRoots: ['/data'] }),
    });
  });

  it('re-pushes on change when the config differs', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    initFileIndexConfigSync();
    await flush();
    expect(invoke).toHaveBeenCalledTimes(1);

    subscribedCallbacks.forEach((cb) => cb({ fileSearch: cfg({ enabled: false }) }));
    await flush();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenNthCalledWith(2, 'file_index_set_config', {
      config: cfg({ enabled: false }),
    });
  });

  it('suppresses re-push when the config is identical', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    initFileIndexConfigSync();
    await flush();
    expect(invoke).toHaveBeenCalledTimes(1);

    subscribedCallbacks.forEach((cb) => cb({ fileSearch: cfg() }));
    await flush();

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('re-init replaces the previous subscription', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    initFileIndexConfigSync();
    await flush();
    expect(subscribedCallbacks.length).toBe(1);

    initFileIndexConfigSync();
    await flush();
    expect(subscribedCallbacks.length).toBe(1);
  });

  it('swallows invoke errors without throwing', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('rust not ready'));

    expect(() => initFileIndexConfigSync()).not.toThrow();
    await flush();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith('feedback_publish', expect.any(Object));
  });
});
