import Fuse from "fuse.js";
import { tauriDocEntries } from "./docEntries";
import type { DocEntry } from "./types/DocEntry";

// Configure Fuse.js for fuzzy searching
const fuseOptions = {
  includeScore: true,
  keys: [
    { name: "title", weight: 0.4 },
    { name: "description", weight: 0.2 },
    { name: "keywords", weight: 0.4 },
  ],
  threshold: 0.4,
};

const fuse = new Fuse(tauriDocEntries, fuseOptions);

/**
 * Search documentation based on a query
 * @param query Search query string
 * @returns Matching documentation entries
 */
export async function searchDocs(query: string): Promise<DocEntry[]> {
  if (!query || query.trim().length === 0) {
    // Return all docs sorted by category if no query
    return [...tauriDocEntries].sort((a, b) =>
      a.category.localeCompare(b.category)
    );
  }

  const results = fuse.search(query);
  return results.map((result) => result.item);
}

/**
 * Get documentation entries by category
 * @param category Category name
 * @returns Documentation entries in the specified category
 */
export function getDocsByCategory(category: string): DocEntry[] {
  return tauriDocEntries.filter((doc) => doc.category === category);
}

/**
 * Get all unique documentation categories
 * @returns Array of category names
 */
export function getCategories(): string[] {
  return [...new Set(tauriDocEntries.map((doc) => doc.category))].sort();
}
