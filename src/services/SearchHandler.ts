import SearchManager from "./searchManager";
import type { SearchResults } from "../types";
import { ActionHandlerService } from "./ActionHandlerService";
import { log } from "../api/services/log";

export class SearchHandler {
  static async handleSearch(query: string, store: any): Promise<SearchResults> {
    try {
      if (!query.trim()) {
        return { categories: [] };
      }

      const actionHandler = new ActionHandlerService(store);
      const results = await SearchManager.search(query.trim());

      return {
        categories: results.categories.map((category) => ({
          ...category,
          items: category.items.map((item) => ({
            ...item,
            action: async () =>
              actionHandler.executeAction(item.title, item.category),
          })),
        })),
      };
    } catch (error) {
      log.error(`Search error: ${error}`);
      return { categories: [] };
    }
  }

  static async updateSearchHistory(store: any, title: string): Promise<void> {
    if (!store) return;

    const now = Date.now();
    let item = await store.get(title);

    if (item) {
      item.frequency = (item.frequency || 0) + 1;
      item.lastUsed = now;
    } else {
      item = { frequency: 1, lastUsed: now };
    }

    await store.set(title, item);
    await store.save();
  }
}
