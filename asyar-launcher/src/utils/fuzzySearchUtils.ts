import Fuse from "fuse.js";
import type { ExtensionResult } from "asyar-api";

/**
 * Default fuse.js options
 */
export const DEFAULT_FUSE_OPTIONS = {
  // Search in these keys
  keys: ["title", "subtitle", "keywords"],
  // Include score in results (lower is better)
  includeScore: true,
  // Threshold: 0 is exact match, 1 matches anything (0.3 is a good balance)
  threshold: 0.3,
  // Favor matches that are closer to the beginning of the string
  location: 0,
  // Match up to this length from the location
  distance: 100,
  // Case-sensitive search?
  isCaseSensitive: false,
  // Sort results by score
  shouldSort: true,
  // Boost exact prefix matches (helpful for command prefix matches)
  findAllMatches: false,
  // Boost field importance by different amounts
  weightedSearch: true,
  // Minimum length of query before fuzzy search kicks in
  minMatchCharLength: 1,
  // If true, allows transpositions ('laptop' matches 'latpop')
  ignoreLocation: false,
};

/**
 * Create a Fuse instance with the given items and options
 */
export function createFuseInstance<T>(
  items: T[],
  options?: Partial<Fuse.IFuseOptions<T>>
) {
  return new Fuse(items, {
    ...DEFAULT_FUSE_OPTIONS,
    ...options,
  });
}

/**
 * Convert Fuse results back to the original item format with scores normalized to 0-100
 */
export function processFuseResults<T>(
  results: Fuse.FuseResult<T>[]
): Array<T & { score: number }> {
  return results.map((result) => ({
    ...result.item,
    score: Math.round((1 - (result.score || 0)) * 100), // Convert to 0-100 where 100 is best match
  }));
}

/**
 * Perform a fuzzy search using Fuse.js
 */
export function performFuzzySearch<T>(
  items: T[],
  query: string,
  options?: Partial<Fuse.IFuseOptions<T>>
): Array<T & { score: number }> {
  // For empty queries, return all items with perfect scores
  if (!query || query.trim() === "") {
    return items.map((item) => ({ ...item, score: 100 }));
  }

  const fuse = createFuseInstance(items, options);
  const results = fuse.search(query);
  return processFuseResults(results);
}
