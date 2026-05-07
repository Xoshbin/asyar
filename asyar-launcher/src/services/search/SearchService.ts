import { logService } from "../log/logService";
import { diagnosticsService } from "../diagnostics/diagnosticsService.svelte";
import type { SearchResult } from "./interfaces/SearchResult";
import type { SearchableItem } from "./types/SearchableItem";
import * as commands from "../../lib/ipc/commands";

export class SearchService {
  async performSearch(query: string): Promise<SearchResult[]> {
    try {
      const results = (await commands.searchItems(query)) as SearchResult[];
      logService.debug(`Search results for "${query}": ${results}`);
      return results;
    } catch (error) {
      logService.error(`Search failed: ${error}`);
      void diagnosticsService.report({
        source: 'frontend',
        kind: 'search/perform-failed',
        severity: 'error',
        retryable: false,
        developerDetail: String(error),
        // Length only — the raw query may contain pasted secrets.
        context: { queryLength: String(query.length) },
      });
      return [];
    }
  }

  /**
   * Indexes a single item (Application or Command) by calling the Rust backend.
   * Handles updates automatically (Rust's index_item deletes then adds).
   */
  async indexItem(item: SearchableItem): Promise<void> {
    try {
      logService.debug(
        `Indexing item category: ${item.category}, name: ${item.name}`
      );
      await commands.indexItem(item);
    } catch (error) {
      logService.error(`Failed indexing item ${item.name}: ${error}`);
      void diagnosticsService.report({
        source: 'frontend',
        kind: 'search/index-failed',
        severity: 'warning',
        retryable: false,
        developerDetail: String(error),
        context: { name: item.name, category: String(item.category) },
      });
    }
  }

  /**
   * Indexes multiple items in a single Rust call with one disk write.
   * Use this for bulk operations (startup app scan, command sync) instead
   * of calling indexItem() in a loop.
   */
  async batchIndexItems(items: SearchableItem[]): Promise<void> {
    if (items.length === 0) return;
    try {
      logService.debug(`Batch indexing ${items.length} items`);
      await commands.batchIndexItems(items);
    } catch (error) {
      logService.error(`Failed batch indexing ${items.length} items: ${error}`);
      void diagnosticsService.report({
        source: 'frontend',
        kind: 'search/batch-index-failed',
        severity: 'warning',
        retryable: false,
        developerDetail: String(error),
        context: { count: String(items.length) },
      });
    }
  }

  /**
   * Deletes an item from the index by its object ID.
   */
  async deleteItem(objectId: string): Promise<void> {
    try {
      logService.debug(`Deleting item with objectId: ${objectId}`);
      await commands.deleteItem(objectId);
    } catch (error) {
      logService.error(`Failed deleting item ${objectId}: ${error}`);
      void diagnosticsService.report({
        source: 'frontend',
        kind: 'search/delete-failed',
        severity: 'warning',
        retryable: false,
        developerDetail: String(error),
        context: { objectId },
      });
    }
  }

  /**
   * Gets all indexed object IDs, optionally filtering by prefix.
   */
  async getIndexedObjectIds(prefix?: "app_" | "cmd_"): Promise<Set<string>> {
    try {
      logService.debug(
        `Fetching indexed object IDs ${
          prefix ? `with prefix "${prefix}"` : ""
        }...`
      );
      const allIndexedIds = await commands.getIndexedObjectIds();
      if (!prefix) {
        return allIndexedIds;
      }
      const filteredIds = new Set<string>();
      allIndexedIds.forEach((id) => {
        if (id.startsWith(prefix)) {
          filteredIds.add(id);
        }
      });
      logService.debug(
        `Found ${filteredIds.size} IDs with prefix "${prefix}".`
      );
      return filteredIds;
    } catch (error) {
      logService.error(`Failed to get indexed object IDs: ${error}`);
      void diagnosticsService.report({
        source: 'frontend',
        kind: 'search/list-ids-failed',
        severity: 'warning',
        retryable: false,
        developerDetail: String(error),
        context: { prefix: prefix ?? '' },
      });
      return new Set<string>();
    }
  }

  async resetIndex(): Promise<void> {
    try {
      logService.info("Requesting search index reset...");
      await commands.resetSearchIndex();
      logService.info("Search index reset successful.");
    } catch (error) {
      logService.error(`Failed to reset search index: ${error}`);
      void diagnosticsService.report({
        source: 'frontend',
        kind: 'search/reset-failed',
        severity: 'error',
        retryable: false,
        developerDetail: String(error),
      });
    }
  }

  /**
   * Explicitly saves the search index to disk.
   * Currently used before hiding the launcher to persist usage counts.
   */
  async saveIndex(): Promise<void> {
    try {
      await commands.saveSearchIndex();
    } catch (error) {
      logService.error(`Failed to save search index: ${error}`);
      void diagnosticsService.report({
        source: 'frontend',
        kind: 'search/save-failed',
        severity: 'warning',
        retryable: false,
        developerDetail: String(error),
      });
    }
  }
}

export const searchService = new SearchService();
