import { searchBuiltinProviders, executeBuiltinSearchResult } from './builtinSearchProviders';
import { isAppInitialized } from '../appInitState';
import extensionManager from '../extension/extensionManager.svelte';
import { viewManager } from '../extension/viewManager.svelte';
import { searchStores } from './stores/search.svelte';
import { logService } from '../log/logService';
import type { SearchResult } from './interfaces/SearchResult';
import type { ExtensionResult } from 'asyar-sdk/contracts';
import { getCachedTopItems, setCachedTopItems, invalidateTopItemsCache } from './topItemsCache';
import * as commands from '../../lib/ipc/commands';
import { dispatch } from '../extension/extensionDispatcher.svelte';
import { commandService } from '../extension/commandService.svelte';
import { isBuiltInFeature } from '../extension/extensionDiscovery';
import { contextModeService } from '../context/contextModeService.svelte';
import { actionService, setSelectedItemProvider } from '../action/actionService.svelte';

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
  // Tier 1 built-ins run in the host context — no iframe to warm. Ask the
  // registry rather than trusting `item.isBuiltIn`: search results come from
  // Rust, whose `SearchResult` has no such field, so that check was always
  // undefined and every built-in row warmed an iframe that never arrives.
  if (item.isBuiltIn || isBuiltInFeature(item.extensionId)) return;
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
  #resultActions = new Map<
    string,
    { extensionId: string; actionId: string; actionPayload: unknown }
  >();
  // Maps a search-result objectId to its direct action execution handler (e.g. Calculator's copy-to-clipboard).
  // First-class platform primitives execute directly without temporary closure-stashing side-tables.
  #directActions = new Map<string, () => void | Promise<void>>();

  async handleSearch(query: string): Promise<void> {
    if (!isAppInitialized() || viewManager.activeView) return;
    const token = ++this.#searchToken;
    const resultActions = new Map<
      string,
      { extensionId: string; actionId: string; actionPayload: unknown }
    >();
    const directActions = new Map<string, () => void | Promise<void>>();
    searchStores.isLoading = true;
    logService.debug(`Starting combined search for query: "${query}"`);
    try {
      // Collect extension results (these run in JS, can't move to Rust)
      const [resultsFromExtensions, builtinRows] = await Promise.all([
        extensionManager.searchAll(query),
        searchBuiltinProviders(query, (id) => extensionManager.isExtensionEnabled(id)),
      ]);
      const builtinById = new Map(builtinRows.map((row) => [row.id, row]));

      // Map extension results to serializable format for Rust
      const externalResults = resultsFromExtensions.map(
        (extRes: ExtensionResult & { extensionId?: string }, index: number) => {
          const objectId =
            extRes.id ||
            `ext_${extRes.extensionId || 'unknown'}_${extRes.title.replace(/\s+/g, '_')}_${index}`;
          if (extRes.actionId && extRes.extensionId) {
            resultActions.set(objectId, {
              extensionId: extRes.extensionId,
              actionId: extRes.actionId,
              actionPayload: extRes.actionPayload,
            });
          }
          // Direct, typed action execution path for platform primitives / built-ins
          if (typeof extRes.action === 'function') {
            directActions.set(objectId, extRes.action);
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
            priority:
              extRes.extensionId && isBuiltInFeature(extRes.extensionId)
                ? extRes.priority
                : undefined,
          };
        },
      );

      externalResults.push(
        ...builtinRows.map((row) => ({
          objectId: row.id,
          name: row.title,
          description: row.subtitle,
          type: 'command',
          score: row.score ?? 0.5,
          icon: row.icon,
          extensionId: row.extensionId,
          category: 'builtin',
          style: row.style,
          priority: row.priority,
        })),
      );
      const resp = await commands.mergedSearch(query, externalResults, 10);
      const combinedResults: SearchResult[] = resp.results as SearchResult[];
      const aliasMatch = resp.aliasMatch ?? null;
      if (token !== this.#searchToken) return;
      this.#resultActions = resultActions;
      this.#directActions = directActions;

      // Direct action execution path: attach direct action reference if present
      for (const r of combinedResults) {
        const builtin = builtinById.get(r.objectId);
        if (builtin) {
          r.action = () =>
            executeBuiltinSearchResult(builtin.extensionId, builtin.id, builtin.actionPayload).then(
              () => {},
            );
          continue;
        }
        const action = directActions.get(r.objectId);
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
          // If the aliased command needs a typed query (e.g. a portal with a
          // {query} placeholder), firing it now would resolve with an empty
          // value. Arm its context mode instead — same as pressing Tab — so
          // the user types the parameter before it runs (issue #433 follow-up).
          const provider = contextModeService.getProviderForCommand(aliasMatch.objectId);
          if (provider?.needsQuery) {
            searchStores.query = '';
            contextModeService.activate(provider.id, '');
          } else {
            void commandService.executeCommand(aliasMatch.objectId);
            searchStores.query = '';
          }
          this.items = [];
          this.lastCompletedQuery = '';
          if (token === this.#searchToken) searchStores.isLoading = false;
          return;
        }
      } else if (this.#lastAutoExecutedQuery !== null && this.#lastAutoExecutedQuery !== query) {
        // Query changed (e.g. user typed more, or input was cleared) — release the guard.
        this.#lastAutoExecutedQuery = null;
      }

      // Pin-to-top and disabled-application filtering are done in Rust
      // (merged_search/merged_search_with_aliases) — combinedResults already
      // reflects both.

      // Seed top items cache on empty query
      if (query.trim() === '' && getCachedTopItems() === null) {
        setCachedTopItems(combinedResults);
      }

      if (token !== this.#searchToken) return;
      this.items = combinedResults;
      this.lastCompletedQuery = query;
    } catch (error) {
      logService.error(`Combined search failed: ${error}`);
      if (token !== this.#searchToken) return;
      this.#resultActions.clear();
      this.#directActions.clear();
      this.items = [];
      this.lastCompletedQuery = query;
    } finally {
      if (token === this.#searchToken) searchStores.isLoading = false;
    }
  }

  /**
   * If the highlighted search result carries a direct action (e.g. Calculator)
   * or a worker-side action (an ExtensionResult with actionId), execute/dispatch it
   * and return true. Returns false for any objectId that is not an action result —
   * the caller then falls through to the normal command activation path.
   */
  tryExecuteResultAction(objectId: string): boolean {
    const info = this.#resultActions.get(objectId);
    if (info) {
      actionService.executeExtensionAction(info.extensionId, info.actionId, info.actionPayload);
      return true;
    }
    const row = this.items.find((item) => item.objectId === objectId);
    if (typeof row?.action === 'function') {
      void row.action();
      return true;
    }
    const directAction = this.#directActions.get(objectId);
    if (directAction) {
      try {
        void directAction();
      } catch (err) {
        logService.error(`Direct result action failed for ${objectId}: ${err}`);
      }
      return true;
    }
    return false;
  }
}

export const searchOrchestrator = new SearchOrchestratorClass();

// Wire provider so actionService doesn't import searchOrchestrator (breaks circular dependency)
setSelectedItemProvider(() => {
  const idx = searchStores.selectedIndex;
  return idx >= 0 ? searchOrchestrator.items[idx] : undefined;
});
