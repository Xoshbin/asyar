import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { handleSearch, searchItems, invalidateTopItemsCache } from './searchOrchestrator';
import { appInitializer } from '../appInitializer';
import extensionManager, { activeView } from '../extension/extensionManager';
import { isSearchLoading } from '../ui/uiStateStore';
import { searchService } from './SearchService';
import { contextModeService } from '../context/contextModeService';
import type { SearchResult } from './interfaces/SearchResult';

// Mocking dependencies
vi.mock('../appInitializer', () => ({
  appInitializer: {
    isAppInitialized: vi.fn(),
  },
}));

vi.mock('../extension/extensionManager', () => {
  const { writable } = require('svelte/store');
  return {
    __esModule: true,
    default: {
      searchAll: vi.fn(),
    },
    activeView: writable(null),
  };
});

vi.mock('../ui/uiStateStore', () => {
  const { writable } = require('svelte/store');
  return {
    isSearchLoading: writable(false),
  };
});

vi.mock('./SearchService', () => ({
  searchService: {
    performSearch: vi.fn(),
  },
}));

vi.mock('../context/contextModeService', () => {
  const { writable } = require('svelte/store');
  return {
    contextModeService: {
      hasStreamProvider: vi.fn(),
      isActive: vi.fn(),
      getHint: vi.fn(),
      contextHint: writable(null),
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

describe('searchOrchestrator characterization tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchItems.set([]);
    activeView.set(null);
    isSearchLoading.set(false);
    invalidateTopItemsCache();
    
    // Default mock behaviors
    vi.mocked(appInitializer.isAppInitialized).mockReturnValue(true);
    vi.mocked(searchService.performSearch).mockResolvedValue([]);
    vi.mocked(extensionManager.searchAll).mockResolvedValue([]);
    vi.mocked(contextModeService.hasStreamProvider).mockReturnValue(false);
    vi.mocked(contextModeService.isActive).mockReturnValue(false);
  });

  it('returns empty and DOES NOT set loading states when app not initialized', async () => {
    vi.mocked(appInitializer.isAppInitialized).mockReturnValue(false);
    
    await handleSearch('test');
    
    expect(get(searchItems)).toEqual([]);
    // In current implementation, if !isAppInitialized() returns before setting loading to true
    expect(get(isSearchLoading)).toBe(false);
  });

  it('returns empty when activeView is set', async () => {
    activeView.set('some-extension/View');
    
    await handleSearch('test');
    
    expect(get(searchItems)).toEqual([]);
    expect(get(isSearchLoading)).toBe(false);
  });

  it('combines Rust and extension results sorted by score', async () => {
    const rustResults = [
      { objectId: 'app_chrome', name: 'Chrome', type: 'application', score: 90000 } as any,
      { objectId: 'app_finder', name: 'Finder', type: 'application', score: 40000 } as any,
    ];
    const extResults = [
      { title: 'Search Google', subtitle: 'Search...', score: 0.8, extensionId: 'portals', icon: '🔍' } as any,
    ];

    vi.mocked(searchService.performSearch).mockImplementation(async (q) => q === 'test' ? rustResults : []);
    vi.mocked(extensionManager.searchAll).mockResolvedValue(extResults);

    await handleSearch('test');

    const results = get(searchItems);
    expect(results).toHaveLength(3);
    // Chrome: 90000/100000 = 0.9, Search Google: 0.8, Finder: 40000/100000 = 0.4
    expect(results[0].name).toBe('Chrome');        // normalized 0.9
    expect(results[1].name).toBe('Search Google');  // 0.8
    expect(results[2].name).toBe('Finder');         // normalized 0.4
  });

  it('maps extension results to SearchResult format', async () => {
    const extResults = [
        { title: 'Test Ext', subtitle: 'Sub', score: 0.8, extensionId: 'test-id', icon: '⭐' } as any
    ];
    vi.mocked(extensionManager.searchAll).mockResolvedValue(extResults);

    await handleSearch('test');

    const results = get(searchItems);
    const mapped = results.find(r => r.name === 'Test Ext');
    expect(mapped).toBeDefined();
    expect(mapped?.objectId).toMatch(/^ext_test-id_Test_Ext_\d+$/);
    expect(mapped?.type).toBe('command');
    expect(mapped?.category).toBe('extension');
    expect(mapped?.description).toBe('Sub');
    expect(mapped?.icon).toBe('⭐');
  });

  it('empty query returns usage-sorted results without suggestion backfill', async () => {
    const items = [
        { objectId: '1', name: 'App 1', score: 90000 } as any,
        { objectId: '2', name: 'App 2', score: 80000 } as any,
    ];
    vi.mocked(searchService.performSearch).mockResolvedValue(items);

    await handleSearch('');

    expect(searchService.performSearch).toHaveBeenCalledTimes(1); // Only once for ''
    expect(searchService.performSearch).toHaveBeenCalledWith('');
    const results = get(searchItems);
    expect(results).toHaveLength(2);
    expect(results.every(r => r.score !== -1.0)).toBe(true);
  });

  it('non-empty query backfills suggestions to reach 10 items', async () => {
    const searchResults = [
      { objectId: 's1', name: 'Result 1', score: 90000 } as any,
      { objectId: 's2', name: 'Result 2', score: 80000 } as any,
      { objectId: 's3', name: 'Result 3', score: 70000 } as any,
    ];
    const suggestionResults = Array.from({ length: 15 }, (_, i) => ({
      objectId: `suggest_${i}`,
      name: `Suggestion ${i}`,
      score: 50000
    })) as any[];

    vi.mocked(searchService.performSearch).mockImplementation(async (q) => q === 'x' ? searchResults : suggestionResults);

    await handleSearch('x');

    const results = get(searchItems);
    expect(results).toHaveLength(10);
    expect(results.slice(0, 3).map(r => r.name)).toEqual(['Result 1', 'Result 2', 'Result 3']);
    expect(results.slice(3)).toHaveLength(7);
    expect(results.slice(3).every(r => r.score === -1.0)).toBe(true);
  });

  it('does not duplicate items when backfilling suggestions', async () => {
    const searchResults = [
        { objectId: 'dup', name: 'Duplicate', score: 90000 } as any,
    ];
    const suggestionResults = [
        { objectId: 'dup', name: 'Duplicate', score: 50000 } as any,
        { objectId: 'unique', name: 'Unique', score: 10000 } as any,
    ];

    vi.mocked(searchService.performSearch).mockImplementation(async (q) => q === 'x' ? searchResults : suggestionResults);

    await handleSearch('x');

    const results = get(searchItems);
    const names = results.map(r => r.name);
    expect(names.filter(n => n === 'Duplicate')).toHaveLength(1);
    expect(names).toContain('Unique');
  });

  it('injects Ask AI result when context mode has stream provider and query is non-empty', async () => {
    vi.mocked(contextModeService.hasStreamProvider).mockReturnValue(true);
    vi.mocked(contextModeService.isActive).mockReturnValue(false);
    vi.mocked(contextModeService.getHint).mockReturnValue({ type: 'ai' } as any);
    
    const searchResults = [{ objectId: 'r1', name: 'Result 1', score: 96000 }] as any;
    vi.mocked(searchService.performSearch).mockResolvedValue(searchResults);

    await handleSearch('what is rust');

    const results = get(searchItems);
    expect(results).toHaveLength(2);
    // Result 1: 96000/100000 = 0.96. Ask AI: 0.95.
    // Order: Result 1 (0.96) is at slice(0,1), Ask AI is inserted at [1].
    expect(results[0].name).toBe('Result 1');
    expect(results[1].objectId).toBe('cmd_ai-chat_ask');
    expect(results[1].name).toBe('Ask AI');
    expect(results[1].score).toBe(0.95);
  });

  it('does not inject Ask AI when context mode is active', async () => {
    vi.mocked(contextModeService.hasStreamProvider).mockReturnValue(true);
    vi.mocked(contextModeService.isActive).mockReturnValue(true);
    
    await handleSearch('test');

    const results = get(searchItems);
    expect(results.find(r => r.objectId === 'cmd_ai-chat_ask')).toBeUndefined();
  });

  it('does not inject Ask AI when query is empty', async () => {
    vi.mocked(contextModeService.hasStreamProvider).mockReturnValue(true);
    vi.mocked(contextModeService.isActive).mockReturnValue(false);
    
    await handleSearch('');

    const results = get(searchItems);
    expect(results.find(r => r.objectId === 'cmd_ai-chat_ask')).toBeUndefined();
  });

  it('handles search errors gracefully', async () => {
    vi.mocked(searchService.performSearch).mockRejectedValue(new Error('search failed'));
    
    await handleSearch('test');

    expect(get(searchItems)).toEqual([]);
    expect(get(isSearchLoading)).toBe(false);
  });

  it('sets isSearchLoading to true during search and false after', async () => {
    let resolveSearch: (value: any) => void;
    const searchPromise = new Promise(resolve => {
        resolveSearch = resolve;
    });
    vi.mocked(searchService.performSearch).mockReturnValue(searchPromise as Promise<SearchResult[]>);

    const handleSearchPromise = handleSearch('test');

    expect(get(isSearchLoading)).toBe(true);

    resolveSearch!([]);
    await handleSearchPromise;

    expect(get(isSearchLoading)).toBe(false);
  });

  it('empty_query_search_populates_cache', async () => {
    const topItems = [{ objectId: '1', name: 'App 1', score: 90000 } as any];
    vi.mocked(searchService.performSearch).mockResolvedValue(topItems);

    await handleSearch('');
    expect(searchService.performSearch).toHaveBeenCalledWith('');
    expect(searchService.performSearch).toHaveBeenCalledTimes(1);

    // Second search with non-empty query should use the cache
    vi.mocked(searchService.performSearch).mockResolvedValue([]); // Clear for second call (not that it matters because it shouldn't be called)
    await handleSearch('test');

    // Should only have been called with 'test', not with '' again
    const calls = vi.mocked(searchService.performSearch).mock.calls;
    expect(calls.filter(c => c[0] === '').length).toBe(1); // Still only 1 total empty-query call
    expect(calls.find(c => c[0] === 'test')).toBeDefined();
  });

  it('second_search_uses_cached_top_items_without_IPC_call', async () => {
    const topItems = [{ objectId: '1', name: 'App 1', score: 90000 } as any];
    vi.mocked(searchService.performSearch).mockImplementation(async (q) => q === '' ? topItems : []);

    // First search: Should call performSearch('')
    await handleSearch('x');
    const firstCalls = vi.mocked(searchService.performSearch).mock.calls;
    expect(firstCalls.some(c => c[0] === '')).toBe(true);

    vi.clearAllMocks();
    vi.mocked(searchService.performSearch).mockImplementation(async (q) => q === 'y' ? [] : []);

    // Second search: Should NOT call performSearch('') again
    await handleSearch('y');
    const secondCalls = vi.mocked(searchService.performSearch).mock.calls;
    expect(secondCalls.some(c => c[0] === '')).toBe(false);
    expect(secondCalls.some(c => c[0] === 'y')).toBe(true);
  });

  it('cache_is_invalidated_after_invalidateTopItemsCache_called', async () => {
    const topItems = [{ objectId: '1', name: 'App 1', score: 90000 } as any];
    vi.mocked(searchService.performSearch).mockImplementation(async (q) => q === '' ? topItems : []);

    // Populate cache
    await handleSearch('x');
    expect(vi.mocked(searchService.performSearch).mock.calls.some(c => c[0] === '')).toBe(true);

    invalidateTopItemsCache();
    vi.clearAllMocks();

    // Search after invalidation should hit Rust again
    await handleSearch('y');
    expect(vi.mocked(searchService.performSearch).mock.calls.some(c => c[0] === '')).toBe(true);
  });
});
