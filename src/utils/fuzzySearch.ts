import Fuse from "fuse.js";

interface FuzzySearchOptions {
  keys: string[];
  threshold?: number;
  distance?: number;
  includeScore?: boolean;
}

/**
 * Performs fuzzy search on a collection using Fuse.js
 *
 * @param collection - The array of items to search in
 * @param query - The search query
 * @param options - Search configuration options
 * @returns Array of matched items with scores
 */
export function fuzzySearch<T>(
  collection: T[],
  query: string,
  options: FuzzySearchOptions
): (T & { score?: number })[] {
  if (!query || query.trim() === "") {
    return collection.map((item) => ({ ...item, score: undefined }));
  }

  const defaultOptions = {
    includeScore: true,
    threshold: 0.3, // Lower values = more strict matching (0 = exact match only)
    distance: 100, // How far to look for matching characters
    minMatchCharLength: 2,
    shouldSort: true,
  };

  const fuse = new Fuse(collection, {
    ...defaultOptions,
    ...options,
  });

  const results = fuse.search(query);

  // Map results to include the score in the original objects
  return results.map((result) => {
    return {
      ...result.item,
      score: result.score, // Lower score = better match
    };
  });
}
