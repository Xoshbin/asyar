import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/extension/viewManager.svelte', () => {
  let stackSize = 0;
  let shrink = true;
  return {
    viewManager: {
      getNavigationStackSize: vi.fn(() => stackSize),
      goBack: vi.fn(() => {
        if (shrink && stackSize > 0) stackSize--;
      }),
      __setStackSize: (value: number) => {
        stackSize = value;
      },
      __setShrink: (value: boolean) => {
        shrink = value;
      },
    },
  };
});

vi.mock('../../services/search/stores/search.svelte', () => ({
  searchStores: { query: 'leftover query' },
}));

const resetCompact = vi.hoisted(() => vi.fn());
vi.mock('../../services/launcher/compactSyncService.svelte', () => ({
  getCompactSyncService: vi.fn(() => ({ resetToCompactIfConfigured: resetCompact })),
}));

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { resetLauncherState } from './launcherReset';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { searchStores } from '../../services/search/stores/search.svelte';

const vm = viewManager as typeof viewManager & {
  __setStackSize: (value: number) => void;
  __setShrink: (value: boolean) => void;
};

describe('resetLauncherState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vm.__setStackSize(0);
    vm.__setShrink(true);
    searchStores.query = 'leftover query';
  });

  it('drains the navigation stack, clears search, and syncs compact mode', () => {
    vm.__setStackSize(3);

    resetLauncherState();

    expect(viewManager.goBack).toHaveBeenCalledTimes(3);
    expect(viewManager.getNavigationStackSize()).toBe(0);
    expect(searchStores.query).toBe('');
    expect(resetCompact).toHaveBeenCalledTimes(1);
  });

  it('aborts when goBack does not shrink the stack', () => {
    vm.__setStackSize(2);
    vm.__setShrink(false);

    resetLauncherState();

    expect(viewManager.goBack).toHaveBeenCalledTimes(1);
    expect(searchStores.query).toBe('');
  });
});
