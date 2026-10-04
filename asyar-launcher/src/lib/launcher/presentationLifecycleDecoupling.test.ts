import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks
vi.mock('../ipc/invokeSafe', () => ({
  invokeSafe: vi.fn().mockImplementation((cmd: string) => {
    if (cmd === 'is_visible') return Promise.resolve(false);
    if (cmd === 'commit_show') return Promise.resolve(true);
    return Promise.resolve(null);
  }),
}));

vi.mock('../../services/extension/viewManager.svelte', () => {
  let stackSize = 2;
  return {
    viewManager: {
      getNavigationStackSize: vi.fn(() => stackSize),
      goBack: vi.fn(() => {
        if (stackSize > 0) stackSize--;
      }),
    },
  };
});

vi.mock('../../services/search/stores/search.svelte', () => ({
  searchStores: { query: 'test query' },
}));

vi.mock('../../services/launcher/compactSyncService.svelte', () => ({
  getCompactSyncService: vi.fn(() => ({
    resetToCompactIfConfigured: vi.fn(),
  })),
}));

vi.mock('../../services/log/logService', () => ({
  logService: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../services/extension/workerHost.svelte', () => ({
  workerHost: {
    hasWorker: vi.fn().mockReturnValue(true),
    unmount: vi.fn(),
    reset: vi.fn(),
  },
}));

import { showWindow, hideWindow } from '../ipc/windowCommands';
import { resetLauncherState } from './launcherReset';
import { invokeSafe } from '../ipc/invokeSafe';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { searchStores } from '../../services/search/stores/search.svelte';
import { workerHost } from '../../services/extension/workerHost.svelte';

describe('Presentation Lifecycle Decoupling Invariants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('showWindow touches only window presentation commands without touching worker host', async () => {
    // Stub requestAnimationFrame for twoFrames()
    const origRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb) => {
      cb(0);
      return 0;
    };

    try {
      await showWindow();
      expect(invokeSafe).toHaveBeenCalledWith('is_visible');
      expect(invokeSafe).toHaveBeenCalledWith('prepare_show');
      expect(invokeSafe).toHaveBeenCalledWith('commit_show');

      // Crucial: workerHost must never be called on showWindow
      expect(workerHost.unmount).not.toHaveBeenCalled();
      expect(workerHost.reset).not.toHaveBeenCalled();
    } finally {
      globalThis.requestAnimationFrame = origRaf;
    }
  });

  it('hideWindow invokes only the native hide command without tearing down workers', async () => {
    await hideWindow();
    expect(invokeSafe).toHaveBeenCalledWith('hide');
    expect(workerHost.unmount).not.toHaveBeenCalled();
    expect(workerHost.reset).not.toHaveBeenCalled();
  });

  it('resetLauncherState resets query and shrinks navigation stack while preserving worker daemons', () => {
    searchStores.query = 'active user search';

    resetLauncherState();

    expect(viewManager.goBack).toHaveBeenCalled();
    expect(searchStores.query).toBe('');

    // Background workers are long-lived daemons; hiding/resetting the launcher UI must never reset them
    expect(workerHost.unmount).not.toHaveBeenCalled();
    expect(workerHost.reset).not.toHaveBeenCalled();
  });
});
