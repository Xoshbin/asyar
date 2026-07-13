/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: { setActionExecutor: vi.fn(), registerAction: vi.fn(), unregisterAction: vi.fn() },
}));

vi.mock('../../lib/ipc/fileSearchCommands', () => ({
  openInTerminal: vi.fn(),
  quickLookPath: vi.fn(),
  fileSearchClearHistory: vi.fn().mockResolvedValue(true),
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

vi.mock('./aiChipBridge', () => ({
  primeAiChipForFile: vi.fn(),
}));

vi.mock('../../services/run/runService.svelte', () => ({ runService: {} }));

vi.mock('../../services/search/stores/search.svelte', () => ({
  searchStores: { query: '' },
}));

vi.mock('./state.svelte', () => ({
  fileSearchViewState: { searchQuery: '', allItems: [], results: [], deepResults: [] },
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

import extension from './index';
import { actionService } from '../../services/action/actionService.svelte';
import { fileSearchClearHistory } from '../../lib/ipc/fileSearchCommands';
import { fileSearchViewState, runSearch, checkDeepSearchAvailability } from './state.svelte';
import { searchStores } from '../../services/search/stores/search.svelte';
import { tick } from 'svelte';

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
