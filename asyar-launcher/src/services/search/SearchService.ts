import type { SearchProvider } from "./interfaces/SearchProvider";
import type { SearchResult } from "./interfaces/SearchResult";
import type { SearchableItem } from "./types/SearchableItem";

export class SearchService {
  private provider: SearchProvider;

  constructor(provider: SearchProvider) {
    this.provider = provider;
    console.log(
      `SearchService created with provider: ${provider.constructor.name}`
    );
  }

  async performSearch(query: string): Promise<SearchResult[]> {
    console.log(`SearchService delegating search for: ${query}`);
    return this.provider.search(query);
  }

  // Add the index method to delegate indexing
  async index(item: SearchableItem): Promise<void> {
    console.log(
      `SearchService delegating indexing for item type: ${item.category}`
    );
    return this.provider.index(item);
  }
}
