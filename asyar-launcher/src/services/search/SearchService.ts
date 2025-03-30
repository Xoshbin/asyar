// src/services/searchService.ts
import { logService } from "../log/logService";
import type { SearchProvider } from "./interfaces/SearchProvider"; // Keep if needed elsewhere
import type { SearchResult } from "./interfaces/SearchResult";
import type { SearchableItem } from "./types/SearchableItem";
import { invoke } from "@tauri-apps/api/core";

export class SearchService {
  // private provider: SearchProvider;

  // constructor(provider: SearchProvider) {
  //   this.provider = provider;
  //   console.log(
  //     `SearchService created with provider: ${provider.constructor.name}`
  //   );
  // }

  async performSearch(query: string): Promise<SearchResult[]> {
    try {
      const results = await invoke<SearchResult[]>("search_items", { query });
      logService.debug(`Search results for "${query}": ${results}`);
      return results;
    } catch (error) {
      logService.error(`Search failed: ${error}`);
      return []; // Return empty array on error
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
      // Ensure the item structure matches exactly what Rust expects
      await invoke("index_item", { item });
    } catch (error) {
      logService.error(`Failed indexing item ${item.name}: ${error}`);
      // Decide if you need to re-throw the error
      // throw error;
    }
  }

  /**
   * Deletes an item from the index by its object ID.
   */
  async deleteItem(objectId: string): Promise<void> {
    try {
      logService.debug(`Deleting item with objectId: ${objectId}`);
      await invoke("delete_item", { objectId });
    } catch (error) {
      logService.error(`Failed deleting item ${objectId}: ${error}`);
      // Decide if you need to re-throw the error
      // throw error;
    }
  }

  /**
   * Gets all indexed object IDs, optionally filtering by prefix.
   */
  async getIndexedObjectIds(prefix?: "app_" | "cmd_"): Promise<Set<string>> {
    try {
      logService.debug(
        `Workspaceing indexed object IDs ${
          prefix ? `with prefix "${prefix}"` : ""
        }...`
      );
      const allIndexedIds = new Set(
        await invoke<string[]>("get_indexed_object_ids")
      );
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
      return new Set<string>(); // Return empty set on error
    }
  }

  // Optional: Add a method to reset the index
  async resetIndex(): Promise<void> {
    try {
      logService.info("Requesting search index reset...");
      await invoke("reset_search_index");
      logService.info("Search index reset successful.");
    } catch (error) {
      logService.error(`Failed to reset search index: ${error}`);
    }
  }
}

// Export a singleton instance
export const searchService = new SearchService();
