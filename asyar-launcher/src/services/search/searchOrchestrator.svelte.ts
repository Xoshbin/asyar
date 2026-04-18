import { appInitializer } from '../appInitializer';
import extensionManager from '../extension/extensionManager.svelte';
import { viewManager } from '../extension/viewManager.svelte';
import { searchStores } from './stores/search.svelte';
import { searchService } from './SearchService';
import { contextModeService } from '../context/contextModeService.svelte';
import { logService } from '../log/logService';
import type { SearchResult } from './interfaces/SearchResult';
import type { ExtensionResult } from 'asyar-sdk';
import { getCachedTopItems, setCachedTopItems, invalidateTopItemsCache } from './topItemsCache';
import * as commands from '../../lib/ipc/commands';
import { envService } from '../envService';
import { settingsService } from '../settings/settingsService.svelte';

export { invalidateTopItemsCache };

class SearchOrchestratorClass {
  items = $state<SearchResult[]>([]);
  // Query that produced the current `items` — compact-launch expand gate reads
  // this to avoid flashing the previous query's results.
  lastCompletedQuery = $state<string | null>(null);
  // Monotonic token so a slow in-flight search can't overwrite newer results.
  #searchToken = 0;

  async handleSearch(query: string): Promise<void> {
    if (!appInitializer.isAppInitialized() || viewManager.activeView) return;
    const token = ++this.#searchToken;
    searchStores.isLoading = true;
    logService.debug(`Starting combined search for query: "${query}"`);
    try {
      // Collect extension results (these run in JS, can't move to Rust)
      const resultsFromExtensions = await extensionManager.searchAll(query);

      // Map extension results to serializable format for Rust
      const externalResults = resultsFromExtensions.map((extRes: ExtensionResult & { extensionId?: string }, index: number) => ({
        objectId: `ext_${extRes.extensionId || 'unknown'}_${extRes.title.replace(/\s+/g, '_')}_${index}`,
        name: extRes.title,
        description: extRes.subtitle,
        type: 'command',
        score: extRes.score ?? 0.5,
        icon: extRes.icon,
        extensionId: extRes.extensionId,
        category: 'extension',
        style: extRes.style,
      }));

      let combinedResults: SearchResult[];

      if (envService.isTauri) {
        // Single IPC call: Rust does fuzzy search + normalize + merge + sort + dedup + backfill
        combinedResults = (await commands.mergedSearch(query, externalResults, 10)) as SearchResult[];
      } else {
        // Browser fallback: use old local logic
        const resultsFromRust = await searchService.performSearch(query);
        const RUST_SCORE_MAX = 100_000;
        const normalizedRustResults = resultsFromRust.map(r => ({
          ...r,
          score: Math.min((r.score ?? 0) / RUST_SCORE_MAX, 1.0)
        }));

        const mappedExtensionResults: SearchResult[] = externalResults.map(ext => ({
          objectId: ext.objectId,
          name: ext.name,
          description: ext.description ?? undefined,
          type: 'command' as const,
          score: ext.score,
          icon: ext.icon ?? undefined,
          extensionId: ext.extensionId ?? undefined,
          category: ext.category ?? undefined,
          style: ext.style as "default" | "large" | undefined,
        }));

        combinedResults = [...normalizedRustResults, ...mappedExtensionResults];
        combinedResults.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      }

      // Seed top items cache on empty query
      if (query.trim() === '' && getCachedTopItems() === null) {
        setCachedTopItems(combinedResults);
      }

      // Inject "Ask AI" synthetic result (stays in TS — depends on contextModeService)
      if (contextModeService.hasStreamProvider() && query.trim().length > 0 && !contextModeService.isActive()) {
        const hasResults = combinedResults.length > 0;
        const hint = contextModeService.getHint(query, hasResults);
        contextModeService.contextHint = hint;
        if (hint?.type === 'ai') {
          const askAiResult: SearchResult = {
            objectId: 'cmd_ai-chat_ask',
            name: 'Ask AI',
            description: query,
            type: 'command' as const,
            score: 0.95,
            icon: 'icon:ai-chat',
            extensionId: 'ai-chat',
          };
          combinedResults = [
            ...combinedResults.slice(0, 1),
            askAiResult,
            ...combinedResults.slice(1).filter(r => r.objectId !== 'cmd_ai-chat_ask'),
          ];
        }
      }

      // Filter disabled applications (Settings → Applications → enabled toggle).
      // App stays indexed in Rust so toggling is instant — we hide at render.
      const enabledMap = settingsService.currentSettings.search.applicationEnabled ?? {};
      combinedResults = combinedResults.filter(
        r => r.type !== 'application' || enabledMap[r.objectId] !== false
      );

      if (token !== this.#searchToken) return;
      this.items = combinedResults;
      this.lastCompletedQuery = query;
    } catch (error) {
      logService.error(`Combined search failed: ${error}`);
      if (token !== this.#searchToken) return;
      this.items = [];
      this.lastCompletedQuery = query;
    } finally {
      if (token === this.#searchToken) searchStores.isLoading = false;
    }
  }
}

export const searchOrchestrator = new SearchOrchestratorClass();
