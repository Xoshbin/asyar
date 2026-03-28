import type { SearchResult } from './interfaces/SearchResult';

// Module-level cache for top-usage items (backfill suggestions)
let cachedTopItems: SearchResult[] | null = null;

/**
 * Gets the current cached top items.
 */
export function getCachedTopItems(): SearchResult[] | null {
  return cachedTopItems;
}

/**
 * Sets the cached top items.
 */
export function setCachedTopItems(items: SearchResult[]): void {
  cachedTopItems = items;
}

/**
 * Call this when usage is recorded so the cache refreshes on next search.
 */
export function invalidateTopItemsCache(): void {
  cachedTopItems = null;
}
