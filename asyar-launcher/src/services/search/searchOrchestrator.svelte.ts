import { appInitializer } from '../appInitializer';
import extensionManager from '../extension/extensionManager.svelte';
import { viewManager } from '../extension/viewManager.svelte';
import { searchStores } from './stores/search.svelte';
import { logService } from '../log/logService';
import type { SearchResult } from './interfaces/SearchResult';
import type { ExtensionResult } from 'asyar-sdk/contracts';
import { getCachedTopItems, setCachedTopItems, invalidateTopItemsCache } from './topItemsCache';
import * as commands from '../../lib/ipc/commands';
import { settingsService } from '../settings/settingsService.svelte';
import { dispatch } from '../extension/extensionDispatcher.svelte';
import { commandService } from '../extension/commandService.svelte';
import { isBuiltInFeature } from '../extension/extensionDiscovery';
import { actionService } from '../action/actionService.svelte';

export { invalidateTopItemsCache };

/**
 * Fire a predictive warm dispatch when the user highlights a Tier 2
 * command in search results. Causes the dispatcher to begin mounting a
 * dormant extension iframe (or do nothing if already ready) so that
 * activation-on-select feels instant. Safe to call with any item — it
 * only dispatches for `{ type: 'command', extensionId }` shapes.
 */
export function warmIfTier2(
  item: { type?: string; extensionId?: string; isBuiltIn?: boolean } | undefined,
): void {
  if (!item) return;
  if (item.type !== 'command' || !item.extensionId) return;
  // Tier 1 built-ins run in the host context — no iframe to warm.
  if (item.isBuiltIn) return;
  void dispatch({
    extensionId: item.extensionId,
    kind: 'predictiveWarm',
    payload: {},
    source: 'userHighlight',
    commandMode: 'view',
  });
}

class SearchOrchestratorClass {
  items = $state<SearchResult[]>([]);
  // Query that produced the current `items` — compact-launch expand gate reads
  // this to avoid flashing the previous query's results.
  lastCompletedQuery = $state<string | null>(null);
  // Monotonic token so a slow in-flight search can't overwrite newer results.
  #searchToken = 0;
  // Guard against double-firing the alias auto-execute when handleSearch is
  // called twice with the same `<alias> ` query. Cleared whenever the query
  // changes (including the empty string fired by searchStores.clearInput()).
  #lastAutoExecutedQuery: string | null = null;
  // Maps a search-result objectId to the worker-side action it should trigger
  // on Enter. Populated from ExtensionResult.actionId/actionPayload during each
  // search; consulted by searchResultMapper before the normal command lookup.
  #resultActions = new Map<string, { extensionId: string; actionId: string; actionPayload: unknown }>();

  async handleSearch(query: string): Promise<void> {
    if (!appInitializer.isAppInitialized() || viewManager.activeView) return;
    const token = ++this.#searchToken;
    this.#resultActions.clear();
    // Local map for inline action closures (e.g. Calculator's copy-to-clipboard)
    // that can't survive the Rust serialization round-trip. Scoped to this
    // invocation to avoid race conditions between concurrent searches.
    const inlineActions = new Map<string, () => void | Promise<void>>();
    searchStores.isLoading = true;
    logService.debug(`Starting combined search for query: "${query}"`);
    try {
      // Collect extension results (these run in JS, can't move to Rust)
      const resultsFromExtensions = await extensionManager.searchAll(query);

      // Map extension results to serializable format for Rust
      const externalResults = resultsFromExtensions.map((extRes: ExtensionResult & { extensionId?: string }, index: number) => {
        const objectId = `ext_${extRes.extensionId || 'unknown'}_${extRes.title.replace(/\s+/g, '_')}_${index}`;
        if (extRes.actionId && extRes.extensionId) {
          this.#resultActions.set(objectId, {
            extensionId: extRes.extensionId,
            actionId: extRes.actionId,
            actionPayload: extRes.actionPayload,
          });
        }
        // Preserve inline action closures (e.g. Calculator's copy-to-clipboard)
        // that can't survive Rust serialization. Re-attached after mergedSearch.
        if (typeof extRes.action === 'function') {
          inlineActions.set(objectId, extRes.action);
        }
        return {
          objectId,
          name: extRes.title,
          description: extRes.subtitle,
          type: 'command',
          score: extRes.score ?? 0.5,
          icon: extRes.icon,
          extensionId: extRes.extensionId,
          category: 'extension',
          style: extRes.style,
          priority: extRes.extensionId && isBuiltInFeature(extRes.extensionId) ? extRes.priority : undefined,
        };
      });

      const resp = await commands.mergedSearch(query, externalResults, 10);
      let combinedResults: SearchResult[] = resp.results as SearchResult[];
      const aliasMatch = resp.aliasMatch ?? null;

      // Re-attach inline action closures that were stripped for the Rust
      // round-trip (e.g. Calculator's copy-to-clipboard).
      for (const r of combinedResults) {
        const action = inlineActions.get(r.objectId);
        if (action) {
          (r as any).action = action;
        }
      }

      // Auto-execute branch: alias + trailing space on a command runs it
      // immediately and clears the search input. Guard against double-fire
      // when handleSearch runs twice for the same query.
      if (aliasMatch && aliasMatch.autoExecute && aliasMatch.itemType === 'command') {
        if (this.#lastAutoExecutedQuery !== query) {
          this.#lastAutoExecutedQuery = query;
          void commandService.executeCommand(aliasMatch.objectId);
          searchStores.query = '';
          this.items = [];
          this.lastCompletedQuery = '';
          if (token === this.#searchToken) searchStores.isLoading = false;
          return;
        }
      } else if (this.#lastAutoExecutedQuery !== null && this.#lastAutoExecutedQuery !== query) {
        // Query changed (e.g. user typed more, or input was cleared) — release the guard.
        this.#lastAutoExecutedQuery = null;
      }

      // Pin-to-top: trimmed query equals an alias but no auto-execute fired
      // (application alias, or command alias without trailing space). Move
      // the matched objectId to position 0 so the user sees it first.
      if (aliasMatch && !aliasMatch.autoExecute) {
        const idx = combinedResults.findIndex(r => r.objectId === aliasMatch!.objectId);
        if (idx > 0) {
          const [pinned] = combinedResults.splice(idx, 1);
          combinedResults.unshift(pinned);
        }
      }

      // Seed top items cache on empty query
      if (query.trim() === '' && getCachedTopItems() === null) {
        setCachedTopItems(combinedResults);
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

  /**
   * If the highlighted search result carries a worker-side action (an
   * ExtensionResult with actionId), dispatch it and return true. Returns
   * false for any objectId that is not a result-action — the caller then
   * falls through to the normal command activation path.
   */
  tryExecuteResultAction(objectId: string): boolean {
    const info = this.#resultActions.get(objectId);
    if (!info) return false;
    actionService.executeExtensionAction(info.extensionId, info.actionId, info.actionPayload);
    return true;
  }
}

export const searchOrchestrator = new SearchOrchestratorClass();
