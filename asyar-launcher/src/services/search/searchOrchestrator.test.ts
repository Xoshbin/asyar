import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchOrchestrator, invalidateTopItemsCache } from './searchOrchestrator.svelte';
import { appInitializer } from '../appInitializer';
import extensionManager from '../extension/extensionManager.svelte';
import { viewManager } from '../extension/viewManager.svelte';
import { searchStores } from './stores/search.svelte';
import * as commands from '../../lib/ipc/commands';
import { isBuiltInFeature } from '../extension/extensionDiscovery';
import { actionService } from '../action/actionService.svelte';

// Mocking dependencies
vi.mock('../appInitializer', () => ({
  appInitializer: {
    isAppInitialized: vi.fn(),
  },
}));

vi.mock('../extension/viewManager.svelte', () => ({
  viewManager: {
    activeView: null,
    activeViewSearchable: false,
    init: vi.fn(),
    navigateToView: vi.fn(),
    goBack: vi.fn(),
    handleViewSearch: vi.fn(),
    handleViewSubmit: vi.fn(),
    getActiveView: () => null,
    isViewActive: () => false,
  },
}));

vi.mock('../extension/extensionManager.svelte', () => {
  return {
    __esModule: true,
    default: {
      searchAll: vi.fn(),
    },
  };
});

vi.mock('./stores/search.svelte', () => {
  return {
    searchStores: {
      query: '',
      selectedIndex: -1,
      isLoading: false,
    },
  };
});

vi.mock('../log/logService', () => ({
  logService: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../lib/ipc/commands', () => ({
  mergedSearch: vi.fn(),
}));

vi.mock('../extension/extensionDiscovery', () => ({
  isBuiltInFeature: vi.fn(),
}));

vi.mock('../action/actionService.svelte', () => ({
  actionService: {
    executeExtensionAction: vi.fn().mockReturnValue(true),
  },
}));

describe('searchOrchestrator characterization tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchOrchestrator.items = [];
    viewManager.activeView = null;
    searchStores.isLoading = false;
    invalidateTopItemsCache();
    
    // Default mock behaviors
    vi.mocked(appInitializer.isAppInitialized).mockReturnValue(true);
    vi.mocked(extensionManager.searchAll).mockResolvedValue([]);
    vi.mocked(commands.mergedSearch).mockResolvedValue({ results: [], aliasMatch: null });
  });

  it('returns empty and DOES NOT set loading states when app not initialized', async () => {
    vi.mocked(appInitializer.isAppInitialized).mockReturnValue(false);
    
    await searchOrchestrator.handleSearch('test');
    
    expect(searchOrchestrator.items).toEqual([]);
    expect(searchStores.isLoading).toBe(false);
  });

  it('returns empty when activeView is set', async () => {
    viewManager.activeView = 'some-extension/View';
    
    await searchOrchestrator.handleSearch('test');
    
    expect(searchOrchestrator.items).toEqual([]);
    expect(searchStores.isLoading).toBe(false);
  });

  it('combines Rust and extension results sorted by score', async () => {
    const rustResults = [
      { objectId: 'app_chrome', name: 'Chrome', type: 'application', score: 0.9 } as any,
      { objectId: 'ext_portals_Search_Google_0', name: 'Search Google', type: 'command', score: 0.8 } as any,
      { objectId: 'app_finder', name: 'Finder', type: 'application', score: 0.4 } as any,
    ];

    vi.mocked(commands.mergedSearch).mockResolvedValue({ results: rustResults, aliasMatch: null });
    vi.mocked(extensionManager.searchAll).mockResolvedValue([
      { title: 'Search Google', subtitle: 'Search...', score: 0.8, extensionId: 'portals', icon: '🔍' } as any
    ]);

    await searchOrchestrator.handleSearch('test');

    const results = searchOrchestrator.items;
    expect(results).toHaveLength(3);
    expect(results[0].name).toBe('Chrome');
    expect(results[1].name).toBe('Search Google');
    expect(results[2].name).toBe('Finder');
  });

  it('maps extension results to SearchResult format', async () => {
    const extResults = [
        { title: 'Test Ext', subtitle: 'Sub', score: 0.8, extensionId: 'test-id', icon: '⭐' } as any
    ];
    vi.mocked(extensionManager.searchAll).mockResolvedValue(extResults);
    vi.mocked(commands.mergedSearch).mockImplementation(async (query, extensions) => {
        const results = extensions.map((e: any) => ({
            objectId: `ext_${e.extensionId}_${e.name.replace(/\s+/g, '_')}_0`,
            name: e.name,
            type: 'command',
            category: 'extension',
            description: e.description,
            icon: e.icon,
            score: e.score
        } as any));
        return { results, aliasMatch: null };
    });

    await searchOrchestrator.handleSearch('test');

    const results = searchOrchestrator.items;
    const mapped = results.find(r => r.name === 'Test Ext');
    expect(mapped).toBeDefined();
  });

  it('empty query returns usage-sorted results without suggestion backfill', async () => {
    const items = [
        { objectId: '1', name: 'App 1', score: 0.9 } as any,
        { objectId: '2', name: 'App 2', score: 0.8 } as any,
    ];
    vi.mocked(commands.mergedSearch).mockResolvedValue({ results: items, aliasMatch: null });

    await searchOrchestrator.handleSearch('');

    expect(commands.mergedSearch).toHaveBeenCalledTimes(1);
    expect(commands.mergedSearch).toHaveBeenCalledWith('', [], 10);
    const results = searchOrchestrator.items;
    expect(results).toHaveLength(2);
    expect(results.every((r: any) => r.score !== -1.0)).toBe(true);
  });

  it('non-empty query calls mergedSearch with correct arguments', async () => {
    const searchResults = Array.from({ length: 10 }, (_, i) => ({
      objectId: `s${i}`,
      name: `Result ${i}`,
      score: 0.9 - i * 0.1
    })) as any[];

    vi.mocked(extensionManager.searchAll).mockResolvedValue([
      { title: 'Ext', score: 0.5, extensionId: 'e1' } as any
    ]);
    vi.mocked(commands.mergedSearch).mockResolvedValue({ results: searchResults, aliasMatch: null });

    await searchOrchestrator.handleSearch('x');

    expect(commands.mergedSearch).toHaveBeenCalledWith('x', [
      expect.objectContaining({ name: 'Ext', score: 0.5, extensionId: 'e1' })
    ], 10);
    
    const results = searchOrchestrator.items;
    expect(results).toHaveLength(10);
  });

  it('handles search errors gracefully', async () => {
    vi.mocked(commands.mergedSearch).mockRejectedValue(new Error('search failed'));
    
    await searchOrchestrator.handleSearch('test');

    expect(searchOrchestrator.items).toEqual([]);
    expect(searchStores.isLoading).toBe(false);
  });

  it('sets isSearchLoading to true during search and false after', async () => {
    let resolveSearch: (value: any) => void;
    const searchPromise = new Promise(resolve => {
        resolveSearch = resolve;
    });
    vi.mocked(commands.mergedSearch).mockReturnValue(searchPromise as Promise<any>);

    const handleSearchPromise = searchOrchestrator.handleSearch('test');

    expect(searchStores.isLoading).toBe(true);

    resolveSearch!({ results: [], aliasMatch: null });
    await handleSearchPromise;

    expect(searchStores.isLoading).toBe(false);
  });

  it('empty_query_search_populates_cache', async () => {
    const topItems = [{ objectId: '1', name: 'App 1', score: 0.9 } as any];
    vi.mocked(commands.mergedSearch).mockResolvedValue({ results: topItems, aliasMatch: null });

    await searchOrchestrator.handleSearch('');
    expect(commands.mergedSearch).toHaveBeenCalledWith('', [], 10);
    expect(commands.mergedSearch).toHaveBeenCalledTimes(1);
  });

  it('second_search_uses_cached_top_items_without_extra_work', async () => {
    const topItems = [{ objectId: '1', name: 'App 1', score: 0.9 } as any];
    vi.mocked(commands.mergedSearch).mockResolvedValue({ results: topItems, aliasMatch: null });

    await searchOrchestrator.handleSearch(''); // Seeds cache

    vi.clearAllMocks();
    vi.mocked(commands.mergedSearch).mockResolvedValue({ results: [], aliasMatch: null });

    await searchOrchestrator.handleSearch('x');
    expect(commands.mergedSearch).toHaveBeenCalledTimes(1);
    expect(commands.mergedSearch).toHaveBeenCalledWith('x', [], 10);
  });

  it('priority is preserved for built-in extension results', async () => {
    vi.mocked(isBuiltInFeature).mockReturnValue(true);
    vi.mocked(extensionManager.searchAll).mockResolvedValue([
      { extensionId: 'calculator', title: '42', score: 1.0, priority: 'top', type: 'result', action: () => {} } as any,
    ]);

    await searchOrchestrator.handleSearch('6 * 7');

    const callArgs = vi.mocked(commands.mergedSearch).mock.calls[0];
    const externalResults: any[] = callArgs[1];
    expect(externalResults).toEqual(
      expect.arrayContaining([expect.objectContaining({ priority: 'top' })])
    );
  });

  it('priority is stripped for third-party extension results', async () => {
    vi.mocked(isBuiltInFeature).mockReturnValue(false);
    vi.mocked(extensionManager.searchAll).mockResolvedValue([
      { extensionId: 'evil-app-pin', title: 'Always pin me', score: 0.9, priority: 'top', type: 'result', action: () => {} } as any,
    ]);

    await searchOrchestrator.handleSearch('something');

    const callArgs = vi.mocked(commands.mergedSearch).mock.calls[0];
    const externalResults: any[] = callArgs[1];
    expect(externalResults[0].priority).toBeUndefined();
  });

  it('does not inject cmd_agents_ask row even when stream provider is registered and results are non-empty', async () => {
    // After the always-on AI chip change, the AI hint chip lives in the bottom bar
    // (always visible) rather than as an injected search result row.
    // The orchestrator must NOT inject the synthetic cmd_agents_ask row
    // regardless of whether the hint is present.
    const searchResults = [{ objectId: 'r1', name: 'Result 1', score: 0.96 }] as any;
    vi.mocked(commands.mergedSearch).mockResolvedValue({ results: searchResults, aliasMatch: null });

    await searchOrchestrator.handleSearch('settings');

    const results = searchOrchestrator.items;
    const injectedRow = results.find((r: any) => r.objectId === 'cmd_agents_ask');
    expect(injectedRow).toBeUndefined();
  });

  it('tryExecuteResultAction dispatches the action for a result carrying actionId', async () => {
    vi.mocked(extensionManager.searchAll).mockResolvedValue([
      {
        title: 'Toggle Thing',
        subtitle: 'Sub',
        score: 0.8,
        extensionId: 'my-ext',
        actionId: 'toggle',
        actionPayload: { id: 42 },
      } as any,
    ]);
    vi.mocked(commands.mergedSearch).mockResolvedValue({ results: [], aliasMatch: null });

    await searchOrchestrator.handleSearch('toggle');

    const objectId = 'ext_my-ext_Toggle_Thing_0';
    const handled = searchOrchestrator.tryExecuteResultAction(objectId);

    expect(handled).toBe(true);
    expect(vi.mocked(actionService.executeExtensionAction)).toHaveBeenCalledWith(
      'my-ext',
      'toggle',
      { id: 42 },
    );
  });

  it('tryExecuteResultAction returns false for an unknown objectId and does not dispatch', async () => {
    vi.mocked(extensionManager.searchAll).mockResolvedValue([
      {
        title: 'Toggle Thing',
        subtitle: 'Sub',
        score: 0.8,
        extensionId: 'my-ext',
        actionId: 'toggle',
        actionPayload: { id: 42 },
      } as any,
    ]);
    vi.mocked(commands.mergedSearch).mockResolvedValue({ results: [], aliasMatch: null });

    await searchOrchestrator.handleSearch('toggle');

    const handled = searchOrchestrator.tryExecuteResultAction('cmd_some_normal_command');

    expect(handled).toBe(false);
    expect(vi.mocked(actionService.executeExtensionAction)).not.toHaveBeenCalled();
  });

  it('tryExecuteResultAction does not retain stale entries from a previous search', async () => {
    vi.mocked(extensionManager.searchAll).mockResolvedValue([
      {
        title: 'Toggle Thing',
        subtitle: 'Sub',
        score: 0.8,
        extensionId: 'my-ext',
        actionId: 'toggle',
        actionPayload: { id: 42 },
      } as any,
    ]);
    vi.mocked(commands.mergedSearch).mockResolvedValue({ results: [], aliasMatch: null });

    await searchOrchestrator.handleSearch('toggle');
    const objectId = 'ext_my-ext_Toggle_Thing_0';
    expect(searchOrchestrator.tryExecuteResultAction(objectId)).toBe(true);

    // A second search with no actionId results must wipe the side-map.
    vi.mocked(extensionManager.searchAll).mockResolvedValue([]);
    await searchOrchestrator.handleSearch('other');

    expect(searchOrchestrator.tryExecuteResultAction(objectId)).toBe(false);
  });
});
