import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { fsWatcherService } from './fsWatcherService';
import { invoke } from '@tauri-apps/api/core';

describe('fsWatcherService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('create() forwards args to fs_watch_create', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('handle-1');
    const out = await fsWatcherService.create('ext.a', ['/tmp/a'], {
      recursive: true,
      debounceMs: 250,
    });
    expect(invoke).toHaveBeenCalledWith('fs_watch_create', {
      extensionId: 'ext.a',
      paths: ['/tmp/a'],
      opts: { recursive: true, debounceMs: 250 },
    });
    expect(out).toBe('handle-1');
  });

  it('create() normalizes omitted opts to null', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('handle-2');
    await fsWatcherService.create('ext.a', ['/tmp/a']);
    expect(invoke).toHaveBeenCalledWith('fs_watch_create', {
      extensionId: 'ext.a',
      paths: ['/tmp/a'],
      opts: null,
    });
  });

  it('dispose() forwards handleId to fs_watch_dispose', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await fsWatcherService.dispose('ext.a', 'h1');
    expect(invoke).toHaveBeenCalledWith('fs_watch_dispose', {
      extensionId: 'ext.a',
      handleId: 'h1',
    });
  });
});
