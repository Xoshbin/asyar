import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../appInitializer', () => ({
  appInitializer: { isAppInitialized: vi.fn(() => true) },
}));

vi.mock('../extension/viewManager.svelte', () => ({
  viewManager: { activeView: null },
}));

vi.mock('../extension/extensionManager.svelte', () => ({
  __esModule: true,
  default: { searchAll: vi.fn(async () => []) },
}));

vi.mock('./stores/search.svelte', () => ({
  searchStores: { query: '', selectedIndex: -1, isLoading: false },
}));

vi.mock('./SearchService', () => ({
  searchService: { performSearch: vi.fn(async () => []) },
}));

vi.mock('../context/contextModeService.svelte', () => ({
  contextModeService: {
    hasStreamProvider: vi.fn(() => false),
    isActive: vi.fn(() => false),
    getHint: vi.fn(() => null),
    contextHint: null,
  },
}));

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../settings/settingsService.svelte', () => ({
  settingsService: { currentSettings: { search: { applicationEnabled: {} } } },
}));

vi.mock('../envService', () => ({
  envService: { isTauri: true, isBrowser: false },
}));

vi.mock('../extension/extensionDispatcher.svelte', () => ({
  dispatch: vi.fn(),
}));

vi.mock('../extension/commandService.svelte', () => ({
  commandService: { executeCommand: vi.fn() },
}));

vi.mock('../../lib/ipc/commands', () => ({
  mergedSearch: vi.fn(),
}));

import * as commands from '../../lib/ipc/commands';
import { searchStores } from './stores/search.svelte';
import { commandService } from '../extension/commandService.svelte';
import { searchOrchestrator, invalidateTopItemsCache } from './searchOrchestrator.svelte';

const mergedSearchMock = vi.mocked(commands.mergedSearch);
const executeCommand = vi.mocked(commandService.executeCommand);

describe('searchOrchestrator alias handling', () => {
  beforeEach(async () => {
    mergedSearchMock.mockReset();
    executeCommand.mockReset();
    searchOrchestrator.items = [];
    invalidateTopItemsCache();
    // Clear the orchestrator's private auto-execute guard so each test starts
    // from a known state. An empty query with `aliasMatch: null` falls into
    // the guard-clearing else-if branch in handleSearch.
    mergedSearchMock.mockResolvedValueOnce({ results: [], aliasMatch: null });
    await searchOrchestrator.handleSearch('');
    executeCommand.mockReset();
    mergedSearchMock.mockReset();
  });

  it('pins aliased item to top when the trimmed query equals the alias (command, no trailing space)', async () => {
    mergedSearchMock.mockResolvedValueOnce({
      results: [
        { objectId: 'app_other', name: 'Other', type: 'application', score: 0.9 } as any,
        { objectId: 'cmd_clip_history', name: 'Clipboard History', type: 'command', score: 0.5, alias: 'cl' } as any,
      ],
      aliasMatch: { objectId: 'cmd_clip_history', itemType: 'command', autoExecute: false },
    });
    await searchOrchestrator.handleSearch('cl');
    expect(searchOrchestrator.items[0].objectId).toBe('cmd_clip_history');
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('auto-executes command on alias + trailing space and clears the search input', async () => {
    mergedSearchMock.mockResolvedValueOnce({
      results: [
        { objectId: 'cmd_clip_history', name: 'Clipboard History', type: 'command', score: 0.5 } as any,
      ],
      aliasMatch: { objectId: 'cmd_clip_history', itemType: 'command', autoExecute: true },
    });
    await searchOrchestrator.handleSearch('cl ');
    expect(executeCommand).toHaveBeenCalledWith('cmd_clip_history');
    expect(searchStores.query).toBe('');
  });

  it('does not auto-execute applications even on trailing space', async () => {
    mergedSearchMock.mockResolvedValueOnce({
      results: [
        { objectId: 'app_finder', name: 'Finder', type: 'application', score: 1 } as any,
      ],
      aliasMatch: { objectId: 'app_finder', itemType: 'application', autoExecute: false },
    });
    await searchOrchestrator.handleSearch('f ');
    expect(executeCommand).not.toHaveBeenCalled();
    // Still pinned to top.
    expect(searchOrchestrator.items[0].objectId).toBe('app_finder');
  });

  it('does not double-fire when the same auto-execute query repeats', async () => {
    mergedSearchMock.mockResolvedValue({
      results: [
        { objectId: 'cmd_clip_history', name: 'Clipboard History', type: 'command', score: 0.5 } as any,
      ],
      aliasMatch: { objectId: 'cmd_clip_history', itemType: 'command', autoExecute: true },
    });
    await searchOrchestrator.handleSearch('cl ');
    await searchOrchestrator.handleSearch('cl ');
    expect(executeCommand).toHaveBeenCalledTimes(1);
  });

  it('clears the auto-execute guard when the query changes', async () => {
    mergedSearchMock.mockResolvedValue({
      results: [
        { objectId: 'cmd_clip_history', name: 'Clipboard History', type: 'command', score: 0.5 } as any,
      ],
      aliasMatch: { objectId: 'cmd_clip_history', itemType: 'command', autoExecute: true },
    });
    await searchOrchestrator.handleSearch('cl ');

    // Empty query — no aliasMatch — should release the guard.
    mergedSearchMock.mockResolvedValueOnce({ results: [], aliasMatch: null });
    await searchOrchestrator.handleSearch('');

    // Same `cl ` query fires again.
    mergedSearchMock.mockResolvedValueOnce({
      results: [
        { objectId: 'cmd_clip_history', name: 'Clipboard History', type: 'command', score: 0.5 } as any,
      ],
      aliasMatch: { objectId: 'cmd_clip_history', itemType: 'command', autoExecute: true },
    });
    await searchOrchestrator.handleSearch('cl ');
    expect(executeCommand).toHaveBeenCalledTimes(2);
  });

  it('falls through to normal search ordering when aliasMatch is null', async () => {
    mergedSearchMock.mockResolvedValueOnce({
      results: [
        { objectId: 'a', name: 'Alpha', type: 'application', score: 0.9 } as any,
        { objectId: 'b', name: 'Beta', type: 'application', score: 0.8 } as any,
      ],
      aliasMatch: null,
    });
    await searchOrchestrator.handleSearch('al');
    expect(searchOrchestrator.items.map(r => r.objectId)).toEqual(['a', 'b']);
    expect(executeCommand).not.toHaveBeenCalled();
  });
});
