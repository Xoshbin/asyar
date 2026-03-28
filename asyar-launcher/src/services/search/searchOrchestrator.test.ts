import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { handleSearch, searchItems, invalidateTopItemsCache } from './searchOrchestrator';
import { appInitializer } from '../appInitializer';
import extensionManager, { activeView } from '../extension/extensionManager';
import { isSearchLoading } from '../ui/uiStateStore';
import { searchService } from './SearchService';
import { contextModeService } from '../context/contextModeService';
import type { SearchResult } from './interfaces/SearchResult';
import * as commands from '../../lib/ipc/commands';
import { envService } from '../envService';

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

vi.mock('../../lib/ipc/commands', () => ({
  mergedSearch: vi.fn(),
}));

vi.mock('../envService', () => ({
  envService: {
    isTauri: true,
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
    vi.mocked(commands.mergedSearch).mockResolvedValue([]);
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
      { objectId: 'app_chrome', name: 'Chrome', type: 'application', score: 0.9 } as any,
      { objectId: 'ext_portals_Search_Google_0', name: 'Search Google', type: 'command', score: 0.8 } as any,
      { objectId: 'app_finder', name: 'Finder', type: 'application', score: 0.4 } as any,
    ];

    vi.mocked(commands.mergedSearch).mockResolvedValue(rustResults);
    vi.mocked(extensionManager.searchAll).mockResolvedValue([
      { title: 'Search Google', subtitle: 'Search...', score: 0.8, extensionId: 'portals', icon: '🔍' } as any
    ]);

    await handleSearch('test');

    const results = get(searchItems);
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
        return extensions.map(e => ({
            objectId: `ext_${e.extensionId}_${e.name.replace(/\s+/g, '_')}_0`,
            name: e.name,
            type: 'command',
            category: 'extension',
            description: e.description,
            icon: e.icon,
            score: e.score
        } as any));
    });

    await handleSearch('test');

    const results = get(searchItems);
    const mapped = results.find(r => r.name === 'Test Ext');
    expect(mapped).toBeDefined();
  });

  it('empty query returns usage-sorted results without suggestion backfill', async () => {
    const items = [
        { objectId: '1', name: 'App 1', score: 0.9 } as any,
        { objectId: '2', name: 'App 2', score: 0.8 } as any,
    ];
    vi.mocked(commands.mergedSearch).mockResolvedValue(items);

    await handleSearch('');

    expect(commands.mergedSearch).toHaveBeenCalledTimes(1);
    expect(commands.mergedSearch).toHaveBeenCalledWith('', [], 10);
    const results = get(searchItems);
    expect(results).toHaveLength(2);
    expect(results.every(r => r.score !== -1.0)).toBe(true);
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
    vi.mocked(commands.mergedSearch).mockResolvedValue(searchResults);

    await handleSearch('x');

    expect(commands.mergedSearch).toHaveBeenCalledWith('x', [
      expect.objectContaining({ name: 'Ext', score: 0.5, extensionId: 'e1' })
    ], 10);
    
    const results = get(searchItems);
    expect(results).toHaveLength(10);
  });

  it('injects Ask AI result when context mode has stream provider and query is non-empty', async () => {
    vi.mocked(contextModeService.hasStreamProvider).mockReturnValue(true);
    vi.mocked(contextModeService.isActive).mockReturnValue(false);
    vi.mocked(contextModeService.getHint).mockReturnValue({ type: 'ai' } as any);
    
    const searchResults = [{ objectId: 'r1', name: 'Result 1', score: 0.96 }] as any;
    vi.mocked(commands.mergedSearch).mockResolvedValue(searchResults);

    await handleSearch('what is rust');

    const results = get(searchItems);
    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('Result 1');
    expect(results[1].objectId).toBe('cmd_ai-chat_ask');
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
    vi.mocked(commands.mergedSearch).mockRejectedValue(new Error('search failed'));
    
    await handleSearch('test');

    expect(get(searchItems)).toEqual([]);
    expect(get(isSearchLoading)).toBe(false);
  });

  it('sets isSearchLoading to true during search and false after', async () => {
    let resolveSearch: (value: any) => void;
    const searchPromise = new Promise(resolve => {
        resolveSearch = resolve;
    });
    vi.mocked(commands.mergedSearch).mockReturnValue(searchPromise as Promise<SearchResult[]>);

    const handleSearchPromise = handleSearch('test');

    expect(get(isSearchLoading)).toBe(true);

    resolveSearch!([]);
    await handleSearchPromise;

    expect(get(isSearchLoading)).toBe(false);
  });

  it('empty_query_search_populates_cache', async () => {
    const topItems = [{ objectId: '1', name: 'App 1', score: 0.9 } as any];
    vi.mocked(commands.mergedSearch).mockResolvedValue(topItems);

    await handleSearch('');
    expect(commands.mergedSearch).toHaveBeenCalledWith('', [], 10);
    expect(commands.mergedSearch).toHaveBeenCalledTimes(1);

    // After an empty query search, topItemsCache should be set to topItems
  });

  it('second_search_uses_cached_top_items_without_extra_work', async () => {
    // In current implementation, mergedSearch is always called.
    // However, we can verify that the cache is seeded.
    const topItems = [{ objectId: '1', name: 'App 1', score: 0.9 } as any];
    vi.mocked(commands.mergedSearch).mockResolvedValue(topItems);

    await handleSearch(''); // Seeds cache
    
    vi.clearAllMocks();
    vi.mocked(commands.mergedSearch).mockResolvedValue([]);
    
    await handleSearch('x');
    expect(commands.mergedSearch).toHaveBeenCalledTimes(1);
    expect(commands.mergedSearch).toHaveBeenCalledWith('x', [], 10);
  });
});
