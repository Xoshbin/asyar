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

vi.mock('../context/contextModeService.svelte', () => ({
  contextModeService: {
    hasStreamProvider: vi.fn(() => false),
    isActive: vi.fn(() => false),
    getHint: vi.fn(() => null),
    contextHint: null,
    getProviderForCommand: vi.fn(() => null),
    activate: vi.fn(),
  },
}));

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
import { contextModeService } from '../context/contextModeService.svelte';
import { searchOrchestrator, invalidateTopItemsCache } from './searchOrchestrator.svelte';

const mergedSearchMock = vi.mocked(commands.mergedSearch);
const executeCommand = vi.mocked(commandService.executeCommand);
const getProviderForCommand = vi.mocked(contextModeService.getProviderForCommand);
const activate = vi.mocked(contextModeService.activate);

describe('searchOrchestrator alias handling', () => {
  beforeEach(async () => {
    mergedSearchMock.mockReset();
    executeCommand.mockReset();
    getProviderForCommand.mockReset().mockReturnValue(null);
    activate.mockReset();
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

  it('forwards Rust-pinned alias match order verbatim (no re-sort in TS)', async () => {
    // Pin-to-top for a non-auto-executing alias match happens in Rust
    // (merged_search_with_aliases) — the mock here returns results already
    // pinned, and the orchestrator must not reorder them.
    mergedSearchMock.mockResolvedValueOnce({
      results: [
        {
          objectId: 'cmd_clip_history',
          name: 'Clipboard History',
          type: 'command',
          score: 0.5,
          alias: 'cl',
        } as any,
        { objectId: 'app_other', name: 'Other', type: 'application', score: 0.9 } as any,
      ],
      aliasMatch: { objectId: 'cmd_clip_history', itemType: 'command', autoExecute: false },
    });
    await searchOrchestrator.handleSearch('cl');
    expect(searchOrchestrator.items.map((r) => r.objectId)).toEqual([
      'cmd_clip_history',
      'app_other',
    ]);
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('auto-executes command on alias + trailing space and clears the search input', async () => {
    mergedSearchMock.mockResolvedValueOnce({
      results: [
        {
          objectId: 'cmd_clip_history',
          name: 'Clipboard History',
          type: 'command',
          score: 0.5,
        } as any,
      ],
      aliasMatch: { objectId: 'cmd_clip_history', itemType: 'command', autoExecute: true },
    });
    await searchOrchestrator.handleSearch('cl ');
    expect(executeCommand).toHaveBeenCalledWith('cmd_clip_history');
    expect(searchStores.query).toBe('');
  });

  it('activates context mode instead of auto-executing when the aliased command needs a typed query', async () => {
    // Regression for issue #433 follow-up: a portal alias (e.g. "g" -> Search
    // Google) followed by a trailing space must not fire with an empty query.
    getProviderForCommand.mockReturnValue({ id: 'portal_1', needsQuery: true } as any);
    mergedSearchMock.mockResolvedValueOnce({
      results: [
        { objectId: 'cmd_portals_1', name: 'Search Google', type: 'command', score: 0.5 } as any,
      ],
      aliasMatch: { objectId: 'cmd_portals_1', itemType: 'command', autoExecute: true },
    });
    await searchOrchestrator.handleSearch('g ');
    expect(getProviderForCommand).toHaveBeenCalledWith('cmd_portals_1');
    expect(activate).toHaveBeenCalledWith('portal_1', '');
    expect(executeCommand).not.toHaveBeenCalled();
    expect(searchStores.query).toBe('');
  });

  it('still auto-executes a portal alias when the portal has no query placeholder', async () => {
    getProviderForCommand.mockReturnValue({ id: 'portal_2', needsQuery: false } as any);
    mergedSearchMock.mockResolvedValueOnce({
      results: [
        { objectId: 'cmd_portals_2', name: 'Open GitHub', type: 'command', score: 0.5 } as any,
      ],
      aliasMatch: { objectId: 'cmd_portals_2', itemType: 'command', autoExecute: true },
    });
    await searchOrchestrator.handleSearch('gh ');
    expect(executeCommand).toHaveBeenCalledWith('cmd_portals_2');
    expect(activate).not.toHaveBeenCalled();
    expect(searchStores.query).toBe('');
  });

  it('does not auto-execute applications even on trailing space', async () => {
    mergedSearchMock.mockResolvedValueOnce({
      results: [{ objectId: 'app_finder', name: 'Finder', type: 'application', score: 1 } as any],
      aliasMatch: { objectId: 'app_finder', itemType: 'application', autoExecute: false },
    });
    await searchOrchestrator.handleSearch('f ');
    expect(executeCommand).not.toHaveBeenCalled();
    expect(searchOrchestrator.items[0].objectId).toBe('app_finder');
  });

  it('does not double-fire when the same auto-execute query repeats', async () => {
    mergedSearchMock.mockResolvedValue({
      results: [
        {
          objectId: 'cmd_clip_history',
          name: 'Clipboard History',
          type: 'command',
          score: 0.5,
        } as any,
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
        {
          objectId: 'cmd_clip_history',
          name: 'Clipboard History',
          type: 'command',
          score: 0.5,
        } as any,
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
        {
          objectId: 'cmd_clip_history',
          name: 'Clipboard History',
          type: 'command',
          score: 0.5,
        } as any,
      ],
      aliasMatch: { objectId: 'cmd_clip_history', itemType: 'command', autoExecute: true },
    });
    await searchOrchestrator.handleSearch('cl ');
    expect(executeCommand).toHaveBeenCalledTimes(2);
  });

  it('does not re-sort when aliasMatch is present but the matched item is not first', async () => {
    // Rust already decided where the alias match belongs (pinned, or not,
    // e.g. filtered out as a disabled application). The orchestrator must
    // never re-derive ordering from aliasMatch itself.
    mergedSearchMock.mockResolvedValueOnce({
      results: [
        { objectId: 'app_other', name: 'Other', type: 'application', score: 0.9 } as any,
        { objectId: 'app_finder', name: 'Finder', type: 'application', score: 0.5 } as any,
      ],
      aliasMatch: { objectId: 'app_finder', itemType: 'application', autoExecute: false },
    });
    await searchOrchestrator.handleSearch('f');
    expect(searchOrchestrator.items.map((r) => r.objectId)).toEqual(['app_other', 'app_finder']);
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
    expect(searchOrchestrator.items.map((r) => r.objectId)).toEqual(['a', 'b']);
    expect(executeCommand).not.toHaveBeenCalled();
  });
});
