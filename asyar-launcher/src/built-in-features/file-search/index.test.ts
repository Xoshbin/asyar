/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: { setActionExecutor: vi.fn(), registerAction: vi.fn(), unregisterAction: vi.fn() },
}));

vi.mock('../../lib/ipc/fileSearchCommands', () => ({
  openInTerminal: vi.fn(),
  quickLookPath: vi.fn(),
  fileSearchClearHistory: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../services/opener/openerService', () => ({
  openerService: {
    open: vi.fn().mockResolvedValue(undefined),
    openPath: vi.fn().mockResolvedValue(undefined),
    reveal: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/fileManager/fileManagerService', () => ({
  fileManagerService: { trash: vi.fn() },
}));

vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { report: vi.fn() },
}));

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../services/extension/viewManager.svelte', () => ({
  viewManager: { activeViewPrimaryActionLabel: null },
}));

vi.mock('../../services/i18n', () => ({ t: (key: string) => key }));

vi.mock('./aiChipBridge', () => ({
  primeAiChipForFile: vi.fn(),
}));

vi.mock('../../services/run/runService.svelte', () => ({ runService: {} }));

vi.mock('../../services/search/stores/search.svelte', () => ({
  searchStores: { query: '' },
}));

vi.mock('./state.svelte', () => ({
  fileSearchViewState: {
    searchQuery: '',
    allItems: [],
    results: [],
    deepResults: [],
    reset: vi.fn(),
  },
  loadPinnedFiles: vi.fn().mockResolvedValue(undefined),
  checkDeepSearchAvailability: vi.fn().mockResolvedValue(undefined),
  runDeepSearch: vi.fn().mockResolvedValue(undefined),
  getSelectedFile: vi.fn(),
  togglePin: vi.fn().mockResolvedValue(undefined),
  runSearch: vi.fn().mockResolvedValue(undefined),
  recordSelectionForCurrentQuery: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('svelte', () => ({
  tick: vi.fn().mockResolvedValue(undefined),
}));

import { tick } from 'svelte';
import { fileSearchClearHistory } from '../../lib/ipc/fileSearchCommands';
import { actionService } from '../../services/action/actionService.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { searchStores } from '../../services/search/stores/search.svelte';
import extension from './index';
import {
  checkDeepSearchAvailability,
  fileSearchViewState,
  loadPinnedFiles,
  runSearch,
} from './state.svelte';

function makeContext(manager: object) {
  return {
    getService: <T>(_name: string): T => manager as unknown as T,
  };
}

describe('FileSearchExtension class contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('default export is an object with executeCommand', () => {
    expect(typeof extension).toBe('object');
    expect(typeof extension.executeCommand).toBe('function');
  });

  it('executeCommand("show-files") calls navigateToView with the correct path', async () => {
    const navigateToView = vi.fn();
    const ctx = makeContext({ navigateToView });
    await extension.initialize(ctx as never);

    const result = await extension.executeCommand('show-files');

    expect(navigateToView).toHaveBeenCalledWith('file-search/DefaultView');
    expect(result).toEqual({ type: 'view', viewPath: 'file-search/DefaultView' });
  });

  it('initialize checks deep-search availability', async () => {
    const ctx = makeContext({ navigateToView: vi.fn() });
    await extension.initialize(ctx as never);
    expect(checkDeepSearchAvailability).toHaveBeenCalled();
  });

  it('initialize registers clear-history action with the full prefixed id', async () => {
    const ctx = makeContext({ navigateToView: vi.fn() });
    await extension.initialize(ctx as never);

    expect(actionService.setActionExecutor).toHaveBeenCalledWith(
      'act_file-search_clear-history',
      expect.any(Function),
    );
  });

  it('clear-history executor invokes fileSearchClearHistory', async () => {
    const ctx = makeContext({ navigateToView: vi.fn() });
    await extension.initialize(ctx as never);

    const [, executor] = vi.mocked(actionService.setActionExecutor).mock.calls[0];
    await executor();

    expect(fileSearchClearHistory).toHaveBeenCalled();
  });

  it('onViewSearch updates fileSearchViewState.searchQuery', async () => {
    await extension.onViewSearch!('foo');
    expect(fileSearchViewState.searchQuery).toBe('foo');
  });
});

describe('executeCommand("show-files") with query seed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchStores.query = '';
  });

  it('seeds searchQuery and calls runSearch after tick when query is provided', async () => {
    const navigateToView = vi.fn();
    const ctx = makeContext({ navigateToView });
    await extension.initialize(ctx as never);

    await extension.executeCommand('show-files', { query: 'report' });

    expect(tick).toHaveBeenCalled();
    expect(fileSearchViewState.searchQuery).toBe('report');
    expect(runSearch).toHaveBeenCalled();
  });

  it('also seeds the shared search bar (searchStores.query) so it stays visible', async () => {
    const navigateToView = vi.fn();
    const ctx = makeContext({ navigateToView });
    await extension.initialize(ctx as never);

    await extension.executeCommand('show-files', { query: 'invoice' });

    expect(searchStores.query).toBe('invoice');
  });

  it('does not call runSearch when no query is provided', async () => {
    const navigateToView = vi.fn();
    const ctx = makeContext({ navigateToView });
    await extension.initialize(ctx as never);

    await extension.executeCommand('show-files');

    expect(runSearch).not.toHaveBeenCalled();
  });
});

describe('view primary action label', () => {
  beforeEach(() => vi.clearAllMocks());

  it('claims the Open label while the view is active and clears it on exit', async () => {
    await extension.viewActivated('file-search/DefaultView');
    expect(viewManager.activeViewPrimaryActionLabel).toBe('actions.open');

    await extension.viewDeactivated('file-search/DefaultView');
    expect(viewManager.activeViewPrimaryActionLabel).toBeNull();
  });

  it('leaves a foreign label alone when deactivating', async () => {
    await extension.viewActivated('file-search/DefaultView');
    viewManager.activeViewPrimaryActionLabel = 'Run Script';

    await extension.viewDeactivated('file-search/DefaultView');
    expect(viewManager.activeViewPrimaryActionLabel).toBe('Run Script');
  });
});

describe('FileSearchExtension lifecycle: activate and deactivate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'addEventListener');
    vi.spyOn(window, 'removeEventListener');
  });

  it('activate() loads pinned files and probes deep search availability', async () => {
    await extension.activate();
    expect(loadPinnedFiles).toHaveBeenCalledTimes(1);
    expect(checkDeepSearchAvailability).toHaveBeenCalledTimes(1);
  });

  it('activate() propagates failure when loadPinnedFiles fails', async () => {
    const error = new Error('database locked');
    vi.mocked(loadPinnedFiles).mockRejectedValueOnce(error);

    await expect(extension.activate()).rejects.toThrow('database locked');
  });

  it('deactivate() cleans up keydown listener, unregisters view actions, clears action label, and resets view state', async () => {
    await extension.viewActivated('file-search/DefaultView');
    expect(window.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(actionService.registerAction).toHaveBeenCalled();
    expect(viewManager.activeViewPrimaryActionLabel).toBe('actions.open');

    await extension.deactivate();

    expect(window.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(actionService.unregisterAction).toHaveBeenCalledWith('file-search:reveal-in-finder');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('file-search:copy-path');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('file-search:copy-name');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('file-search:open-in-terminal');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('file-search:toggle-pin');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('file-search:move-to-trash');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('file-search:quick-look');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('file-search:send-to-ai');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('file-search:deep-search');
    expect(viewManager.activeViewPrimaryActionLabel).toBeNull();
    expect(fileSearchViewState.reset).toHaveBeenCalledTimes(1);
  });

  it('deactivate() is safe and idempotent when not in view', async () => {
    await extension.deactivate();
    expect(actionService.unregisterAction).toHaveBeenCalledWith('file-search:reveal-in-finder');
    expect(fileSearchViewState.reset).toHaveBeenCalledTimes(1);
  });

  it('re-enabling: activate() restores pinned files and checkDeepSearch without duplicate listeners', async () => {
    await extension.activate();
    expect(loadPinnedFiles).toHaveBeenCalledTimes(1);

    await extension.deactivate();

    await extension.activate();
    expect(loadPinnedFiles).toHaveBeenCalledTimes(2);
    expect(checkDeepSearchAvailability).toHaveBeenCalledTimes(2);
  });
});

describe('viewActivated and viewDeactivated lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'addEventListener');
    vi.spyOn(window, 'removeEventListener');
  });

  it('viewActivated registers view actions and attaches keydown listener', async () => {
    await extension.viewActivated('file-search/DefaultView');
    expect(window.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(actionService.registerAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'file-search:reveal-in-finder' }),
    );
  });

  it('viewDeactivated removes keydown listener and unregisters view actions', async () => {
    await extension.viewActivated('file-search/DefaultView');
    const handler = vi
      .mocked(window.addEventListener)
      .mock.calls.find((call) => call[0] === 'keydown')?.[1];

    await extension.viewDeactivated('file-search/DefaultView');
    expect(window.removeEventListener).toHaveBeenCalledWith('keydown', handler);
    expect(actionService.unregisterAction).toHaveBeenCalledWith('file-search:reveal-in-finder');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('file-search:copy-path');
  });
});
