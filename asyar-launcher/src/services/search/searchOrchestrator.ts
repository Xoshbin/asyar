import { writable, get } from 'svelte/store';
import { appInitializer } from '../appInitializer';
import extensionManager, { activeView } from '../extension/extensionManager';
import { isSearchLoading } from '../ui/uiStateStore';
import { searchService } from './SearchService';
import { contextModeService } from '../context/contextModeService';
import { logService } from '../log/logService';
import type { SearchResult } from './interfaces/SearchResult';
import type { ExtensionResult } from 'asyar-sdk';
import { getCachedTopItems, setCachedTopItems, invalidateTopItemsCache } from './topItemsCache';

export { invalidateTopItemsCache };

export const searchItems = writable<SearchResult[]>([]);

export async function handleSearch(query: string): Promise<void> {
  if (!appInitializer.isAppInitialized() || get(activeView)) return;
  isSearchLoading.set(true);
  // Note: currentError is not extracted as per instructions, it remains in the component
  logService.debug(`Starting combined search for query: "${query}"`);
  try {
    const resultsFromRustPromise = searchService.performSearch(query);
    const resultsFromExtensionsPromise = extensionManager.searchAll(query);
    
    // Fetch or use cached top items for backfill
    let suggestionsPromise: Promise<SearchResult[]> = Promise.resolve([]);
    if (query.trim() !== '') {
      const cached = getCachedTopItems();
      if (cached !== null) {
        suggestionsPromise = Promise.resolve(cached);
      } else {
        suggestionsPromise = searchService.performSearch('').then(results => {
          setCachedTopItems(results);
          return results;
        });
      }
    }

    const [resultsFromRust, resultsFromExtensions, suggestions] = await Promise.all([
      resultsFromRustPromise,
      resultsFromExtensionsPromise,
      suggestionsPromise
    ]);

    // Seed cache on empty query searches
    if (query.trim() === '' && getCachedTopItems() === null) {
      setCachedTopItems(resultsFromRust);
    }

    // Normalize Rust skim scores from [0, 100000] to [0.0, 1.0]
    const RUST_SCORE_MAX = 100_000;
    const normalizedRustResults = resultsFromRust.map(r => ({
      ...r,
      score: Math.min((r.score ?? 0) / RUST_SCORE_MAX, 1.0)
    }));

    const mappedExtensionResults: SearchResult[] = resultsFromExtensions.map((extRes: ExtensionResult & { extensionId?: string }, index) => ({
      objectId: `ext_${extRes.extensionId || 'unknown'}_${extRes.title.replace(/\s+/g, '_')}_${index}`,
      name: extRes.title,
      description: extRes.subtitle,
      type: 'command',
      score: extRes.score ?? 0.5,
      path: undefined,
      category: 'extension',
      extensionId: extRes.extensionId,
      icon: extRes.icon,
      style: extRes.style
    }));

    let combinedResults = [...normalizedRustResults, ...mappedExtensionResults];
    combinedResults.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    if (query.trim() !== '') {
       // Filter out suggestions that we've already included
       const existingNames = new Set(combinedResults.map(r => r.name));
       const existingIds = new Set(combinedResults.map(r => r.objectId));
       const filteredSuggestions = suggestions.filter(s => !existingNames.has(s.name) && !existingIds.has(s.objectId));
       
       // Append suggestions to fill up space, say up to 10 total items
       const appendCount = Math.max(0, 10 - combinedResults.length);
       if (appendCount > 0) {
           const itemsToAppend = filteredSuggestions.slice(0, appendCount).map(s => ({ ...s, score: -1.0 }));
           combinedResults = [...combinedResults, ...itemsToAppend];
       }
    }

     // Inject "Ask AI" synthetic result row when query looks like a question
    if (contextModeService.hasStreamProvider() && query.trim().length > 0 && !contextModeService.isActive()) {
      const hasResults = combinedResults.length > 0;
      const hint = contextModeService.getHint(query, hasResults);
      // Update hint store after we know whether there are results
      contextModeService.contextHint.set(hint);
      // Inject Ask AI row if AI hint would show
      if (hint?.type === 'ai') {
        const askAiResult: SearchResult = {
          objectId: 'cmd_ai-chat_ask',
          name: 'Ask AI',
          description: query,
          type: 'command' as const,
          score: 0.95,
          icon: '🤖',
          extensionId: 'ai-chat',
        };
        // Insert after the first result (so Search Google stays #1)
        combinedResults = [
          ...combinedResults.slice(0, 1),
          askAiResult,
          ...combinedResults.slice(1).filter(r => r.objectId !== 'cmd_ai-chat_ask'),
        ];
      }
    }

    searchItems.set(combinedResults);
  } catch (error) {
    logService.error(`Combined search failed: ${error}`);
    // currentError = "Search failed"; // Instruction says copy verbatim with substitutions, currentError is not in substitutions
    searchItems.set([]);
  } finally {
    isSearchLoading.set(false);
  }
}
