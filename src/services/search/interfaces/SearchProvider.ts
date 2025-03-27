import type { SearchableItem } from "../types/SearchableItem";
import type { SearchResult } from "./SearchResult";

export interface SearchProvider {
  search(query: string): Promise<SearchResult[]>;
  index(item: SearchableItem): Promise<void>; // Add the index method
  // delete?(objectID: string): Promise<void>; // Optional delete method
}
