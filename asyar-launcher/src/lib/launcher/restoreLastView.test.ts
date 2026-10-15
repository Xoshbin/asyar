import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks — declared before imports (vitest hoists vi.mock).
vi.mock('../../services/extension/viewManager.svelte', () => {
  let stackSize = 0;
  let activeView: string | null = null;
  return {
    viewManager: {
      getNavigationStackSize: vi.fn(() => stackSize),
      goBack: vi.fn(() => {
        if (stackSize > 0) stackSize--;
        if (stackSize === 0) activeView = null;
      }),
      navigateToView: vi.fn((path: string) => {
        // Replacement semantics, like the dedicated-shortcut path.
        stackSize = 1;
        activeView = path;
      }),
      get activeView() {
        return activeView;
      },
      __resetState: () => {
        stackSize = 0;
        activeView = null;
      },
    },
  };
});

vi.mock('../../services/search/stores/search.svelte', () => ({
  searchStores: { query: 'leftover query' },
}));

vi.mock('../../services/launcher/compactSyncService.svelte', () => ({
  getCompactSyncService: vi.fn(() => ({
    resetToCompactIfConfigured: vi.fn(),
  })),
}));

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const getSettings = vi.hoisted(() => vi.fn());

vi.mock('../../services/settings/settingsService.svelte', () => ({
  settingsService: { getSettings },
}));

import {
  resetLauncherState,
  resetOnHideIfConfigured,
  resetOnRestoreLastViewDisabled,
} from './launcherReset';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { searchStores } from '../../services/search/stores/search.svelte';

const vm = viewManager as typeof viewManager & { __resetState: () => void };

function generalWith(restoreLastView: boolean | undefined) {
  return {
    general: { startAtLogin: false, showDockIcon: false, showTrayIcon: true, restoreLastView },
  };
}

describe('resetOnHideIfConfigured (Restore Last View)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vm.__resetState();
    getSettings.mockReturnValue(generalWith(true));
  });

  it('does NOT reset when restoreLastView is true (default): view survives hide', () => {
    viewManager.navigateToView('clipboard/ClipboardHistoryView');
    searchStores.query = 'leftover query';

    resetOnHideIfConfigured();

    expect(viewManager.getNavigationStackSize()).toBe(1);
    expect(viewManager.activeView).toBe('clipboard/ClipboardHistoryView');
    expect(searchStores.query).toBe('leftover query');
  });

  it('resets to root search when restoreLastView is false', () => {
    viewManager.navigateToView('clipboard/ClipboardHistoryView');
    searchStores.query = 'leftover query';
    getSettings.mockReturnValue(generalWith(false));

    resetOnHideIfConfigured();

    expect(viewManager.getNavigationStackSize()).toBe(0);
    expect(viewManager.activeView).toBeNull();
    expect(searchStores.query).toBe('');
  });

  it('treats a missing key as enabled (no reset) for pre-setting settings stores', () => {
    viewManager.navigateToView('clipboard/ClipboardHistoryView');
    getSettings.mockReturnValue(generalWith(undefined));

    resetOnHideIfConfigured();

    expect(viewManager.getNavigationStackSize()).toBe(1);
  });

  it('does not reset a stale view when the launcher hides while already at root', () => {
    getSettings.mockReturnValue(generalWith(false));

    resetOnHideIfConfigured();

    // goBack is never called on an empty stack.
    expect(viewManager.goBack).not.toHaveBeenCalled();
    expect(searchStores.query).toBe('');
  });

  it('dedicated shortcut reopened after a hide-driven reset still lands on its view, and a later hide resets again', () => {
    getSettings.mockReturnValue(generalWith(false));

    // Sequence: view open → hide (reset) → dedicated shortcut reopens.
    viewManager.navigateToView('clipboard/ClipboardHistoryView');
    resetOnHideIfConfigured();
    viewManager.navigateToView('clipboard/ClipboardHistoryView');

    expect(viewManager.activeView).toBe('clipboard/ClipboardHistoryView');

    // Hide again → reset fires again (ordering: reset happens on hide, never
    // after the dedicated shortcut already opened the target).
    resetOnHideIfConfigured();
    expect(viewManager.activeView).toBeNull();
    expect(viewManager.getNavigationStackSize()).toBe(0);
  });

  it('resetLauncherState itself remains unconditional (escape hide-and-reset path intact)', () => {
    viewManager.navigateToView('clipboard/ClipboardHistoryView');
    getSettings.mockReturnValue(generalWith(true));

    resetLauncherState();

    expect(viewManager.getNavigationStackSize()).toBe(0);
    expect(searchStores.query).toBe('');
  });
});

describe('resetOnRestoreLastViewDisabled (settings toggle → launcher)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vm.__resetState();
  });

  it('resets the launcher stack when the toggle transitions to false', () => {
    viewManager.navigateToView('clipboard/ClipboardHistoryView');
    searchStores.query = 'leftover query';

    resetOnRestoreLastViewDisabled(false);

    expect(viewManager.getNavigationStackSize()).toBe(0);
    expect(viewManager.activeView).toBeNull();
    expect(searchStores.query).toBe('');
  });

  it('does NOT reset when the toggle transitions to true', () => {
    viewManager.navigateToView('clipboard/ClipboardHistoryView');
    searchStores.query = 'leftover query';

    resetOnRestoreLastViewDisabled(true);

    expect(viewManager.getNavigationStackSize()).toBe(1);
    expect(viewManager.activeView).toBe('clipboard/ClipboardHistoryView');
    expect(searchStores.query).toBe('leftover query');
  });

  it('does NOT reset on a missing/undefined payload (never resets on unrelated emits)', () => {
    viewManager.navigateToView('clipboard/ClipboardHistoryView');

    resetOnRestoreLastViewDisabled(undefined);

    expect(viewManager.getNavigationStackSize()).toBe(1);
  });
});
