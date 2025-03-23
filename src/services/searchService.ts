import { get, writable } from "svelte/store";
import { logService } from "./logService";
import { performanceService } from "./performanceService";
import { ExtensionSearchProvider } from "./providers/ExtensionSearchProvider";
import type { ExtensionResult } from "asyar-api";
import type {
  ISearchService,
  ISearchProvider,
} from "./interfaces/ISearchService";
import { extensionUsageStats, extensionLastUsed } from "./extensionManager";
import {
  applicationUsageStats,
  applicationLastUsed,
} from "./applicationsService";

// Create a store for search state
export const searchState = writable<{
  query: string;
  results: ExtensionResult[];
  loading: boolean;
}>({
  query: "",
  results: [],
  loading: false,
});

/**
 * Centralized search service for the application
 */
class SearchService implements ISearchService {
  private providers: Map<string, ISearchProvider> = new Map();
  private initialized = false;
  private resultCache: Map<
    string,
    { results: ExtensionResult[]; timestamp: number }
  > = new Map();

  // Default extension provider that we'll expose
  readonly extensionProvider = new ExtensionSearchProvider();

  /**
   * Initialize the search service
   */
  async init(): Promise<boolean> {
    if (this.initialized) return true;

    try {
      logService.custom("🔍 Initializing search service...", "SEARCH", "blue");

      // Register the extension provider by default
      this.registerProvider(this.extensionProvider);

      this.initialized = true;
      return true;
    } catch (error) {
      logService.error(`Failed to initialize search service: ${error}`);
      return false;
    }
  }

  /**
   * Register a search provider
   */
  registerProvider(provider: ISearchProvider): void {
    this.providers.set(provider.id, provider);
    logService.debug(`Registered search provider: ${provider.id}`);
  }

  /**
   * Unregister a search provider
   */
  unregisterProvider(providerId: string): void {
    if (this.providers.has(providerId)) {
      this.providers.delete(providerId);
      logService.debug(`Unregistered search provider: ${providerId}`);
    }
  }

  /**
   * Perform search across all providers
   */
  async search(query: string): Promise<ExtensionResult[]> {
    if (!this.initialized) {
      await this.init();
    }

    if (this.providers.size === 0) {
      logService.warn("No search providers registered");
      return [];
    }

    performanceService.startTiming(`search:${query}`);
    searchState.update((state) => ({ ...state, loading: true }));

    try {
      // For empty queries, return default results
      if (!query.trim()) {
        const results = await this.getDefaultResults();
        searchState.update((state) => ({ ...state, results, loading: false }));
        return results;
      }

      // Check cache for recent identical queries
      const cacheKey = query.toLowerCase();
      const cachedResults = this.resultCache.get(cacheKey);
      if (cachedResults && Date.now() - cachedResults.timestamp < 30000) {
        logService.debug(`Using cached results for query: ${query}`);
        searchState.update((state) => ({
          ...state,
          results: cachedResults.results,
          loading: false,
        }));
        return cachedResults.results;
      }

      // Search with all providers in parallel
      const allResults: ExtensionResult[] = [];
      const searchPromises = Array.from(this.providers.values())
        .sort((a, b) => (b.priority || 0) - (a.priority || 0))
        .map((provider) =>
          provider.search(query).catch((error) => {
            logService.error(
              `Error searching with provider ${provider.id}: ${error}`
            );
            return [];
          })
        );

      // Wait for all searches to complete
      const providerResults = await Promise.all(searchPromises);

      // Combine and deduplicate results
      const seenIds = new Set<string>();
      for (const resultSet of providerResults) {
        for (const result of resultSet) {
          // Create a unique ID for each result based on content and source
          const source = (result as any).source || "unknown";
          const resultId = `${source}|${result.title}|${result.type}|${
            result.subtitle || ""
          }`;

          if (!seenIds.has(resultId)) {
            seenIds.add(resultId);

            // Label results with their source if not already labeled
            if (!(result as any).source) {
              if (result.type === "application") {
                (result as any).source = "application";
              } else {
                (result as any).source = "extension";
              }
            }

            // Add visual labeling with consistent formatting
            if (
              (result as any).source === "application" &&
              !result.subtitle?.includes("Application")
            ) {
              result.subtitle = "Application";
            } else if (
              (result as any).source === "extension" &&
              !result.subtitle?.includes("Extension")
            ) {
              // Only add 'Extension' label if it doesn't have a substantive subtitle
              if (!result.subtitle) {
                result.subtitle = "Extension";
              }
            }

            allResults.push(result);
          }
        }
      }

      // Rank results with unified scoring
      this.rankResultsUnified(allResults, query);

      // Cache results
      const limitedResults = allResults.slice(0, 100);
      this.resultCache.set(cacheKey, {
        results: limitedResults,
        timestamp: Date.now(),
      });

      searchState.update((state) => ({
        ...state,
        results: limitedResults,
        loading: false,
      }));

      performanceService.stopTiming(`search:${query}`);
      return limitedResults;
    } catch (error) {
      logService.error(`Search error: ${error}`);
      searchState.update((state) => ({ ...state, loading: false }));
      return [];
    }
  }

  /**
   * Get default results when no query is provided
   */
  async getDefaultResults(): Promise<ExtensionResult[]> {
    const allResults: ExtensionResult[] = [];

    // Get default results from each provider
    const defaultResultPromises = Array.from(this.providers.values())
      .filter((provider) => typeof provider.getDefaultResults === "function")
      .map((provider) =>
        provider.getDefaultResults!().catch((error) => {
          logService.error(
            `Error getting default results from provider ${provider.id}: ${error}`
          );
          return [];
        })
      );

    const providerResults = await Promise.all(defaultResultPromises);
    for (const resultSet of providerResults) {
      allResults.push(...resultSet);
    }

    // Enhance results with recency information if it's missing
    allResults.forEach((result) => {
      const source = (result as any).source;
      if (source === "extension" && !(result as any).recentlyUsed) {
        const extId = (result as any).extensionId;
        if (extId) {
          const lastUsed = get(extensionLastUsed)[extId] || 0;
          if (Date.now() - lastUsed < 86400000) {
            (result as any).recentlyUsed = true;
          }
        }
      } else if (source === "application" && !(result as any).recentlyUsed) {
        const appName = result.title;
        if (appName) {
          const lastUsed = get(applicationLastUsed)[appName] || 0;
          if (Date.now() - lastUsed < 86400000) {
            (result as any).recentlyUsed = true;
          }
        }
      }
    });

    // Final ranking considering both score and recency
    allResults.sort((a, b) => {
      // First compare scores
      const scoreDiff = b.score - a.score;

      // If scores are very close (within 15 points), prioritize recently used items
      if (Math.abs(scoreDiff) < 15) {
        const aRecent = (a as any).recentlyUsed === true;
        const bRecent = (b as any).recentlyUsed === true;
        if (aRecent && !bRecent) return -1;
        if (!aRecent && bRecent) return 1;
      }

      return scoreDiff;
    });

    // Limit to a reasonable number, ensuring we have a mix of apps and extensions
    // Find first 5 apps and first 5 extensions
    const apps = allResults
      .filter((r) => (r as any).source === "application")
      .slice(0, 5);
    const exts = allResults
      .filter((r) => (r as any).source === "extension")
      .slice(0, 5);

    // Interleave results (2 extensions, then 2 apps, then rest)
    const interleaved = [];
    for (let i = 0; i < 3; i++) {
      if (exts[i]) interleaved.push(exts[i]);
    }
    for (let i = 0; i < 2; i++) {
      if (apps[i]) interleaved.push(apps[i]);
    }

    // Add remaining top items
    const alreadyAdded = new Set(
      interleaved.map((i) => `${(i as any).source}|${i.title}`)
    );
    for (const item of allResults) {
      const key = `${(item as any).source}|${item.title}`;
      if (!alreadyAdded.has(key) && interleaved.length < 10) {
        interleaved.push(item);
        alreadyAdded.add(key);
      }
    }

    return interleaved; // Limit default results
  }

  /**
   * Clear the search cache
   */
  clearCache(): void {
    this.resultCache.clear();
    logService.debug("Search cache cleared");
  }

  /**
   * Rank results based on various factors including source
   */
  private rankResults(results: ExtensionResult[], query: string): void {
    const stats = get(extensionUsageStats);

    results.forEach((result) => {
      // Base score adjustments
      let finalScore = result.score || 0;

      // Boost extension results based on usage
      const extensionId = (result as any).extensionId;
      if (extensionId && stats[extensionId]) {
        const boost = Math.min(20, Math.log2(stats[extensionId]) * 5);
        finalScore += boost;
      }

      // Give a small boost to extension results for tie-breaking
      if ((result as any).source === "extension") {
        finalScore += 2;
      }

      // Give extra boost for perfect title matches
      if (query && result.title.toLowerCase() === query.toLowerCase()) {
        finalScore += 30;
      }

      // Update the result score
      result.score = finalScore;
    });

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
  }

  /**
   * Rank results based on a unified scoring system for apps and extensions
   */
  private rankResultsUnified(results: ExtensionResult[], query: string): void {
    const extStats = get(extensionUsageStats);
    const appStats = get(applicationUsageStats);

    // First pass - normalize all scores to a common scale
    results.forEach((result) => {
      const source = (result as any).source;
      let baseScore = result.score || 0;

      // Normalize scores if they're not already on a 0-100 scale
      if (baseScore > 1 && baseScore <= 100) {
        // Score is already in the 0-100 range, keep it
      } else if (baseScore < 1) {
        // Convert from 0-1 scale to 0-100
        baseScore = baseScore * 100;
      }

      // Apply exact query match bonus
      if (query && result.title.toLowerCase() === query.toLowerCase()) {
        baseScore += 30;
      }

      // Apply prefix match bonus
      if (query && result.title.toLowerCase().startsWith(query.toLowerCase())) {
        baseScore += 15;
      }

      // Apply usage-based bonuses based on the source
      if (source === "extension") {
        const extensionId = (result as any).extensionId;
        if (extensionId && extStats[extensionId]) {
          const usageCount = extStats[extensionId];
          const usageBoost = Math.min(20, Math.log2(usageCount + 1) * 5);
          baseScore += usageBoost;

          // Add usage info for transparency
          (result as any).usageCount = usageCount;
        }
      } else if (source === "application") {
        const appName = result.title;
        if (appName && appStats[appName]) {
          const usageCount = appStats[appName];
          const usageBoost = Math.min(20, Math.log2(usageCount + 1) * 5);
          baseScore += usageBoost;

          // Add usage info for transparency
          (result as any).usageCount = usageCount;
        }
      }

      // Cap score at 100
      result.score = Math.min(100, baseScore);
    });

    // Sort purely by score, regardless of source
    results.sort((a, b) => b.score - a.score);
  }
}

export const searchService = new SearchService();
