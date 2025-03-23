import { get } from "svelte/store";
import { logService } from "../logService";
import type { ISearchProvider } from "../interfaces/ISearchService";
import type { ExtensionResult } from "asyar-api";
import {
  applicationService,
  applicationUsageStats,
} from "../applicationsService";
import { performFuzzySearch } from "../../utils/fuzzySearchUtils";
import type { AppResult } from "../../types";

/**
 * Search provider for system applications
 */
export class ApplicationSearchProvider implements ISearchProvider {
  id = "application-provider";
  priority = 90; // Just below extensions (100)
  private appCache: AppResult[] = [];

  /**
   * Search for applications matching the query
   */
  async search(query: string): Promise<ExtensionResult[]> {
    try {
      // Always allow search, even for single-character queries
      if (!query || query.trim() === "") {
        return [];
      }

      // Ensure cache is populated
      if (this.appCache.length === 0) {
        this.appCache = await applicationService.getAllApplications();
      }

      // Convert apps to searchable items
      const searchableItems = this.appCache.map((app) => ({
        id: app.path,
        title: app.name,
        path: app.path,
        _app: app, // Store the original app
      }));

      // Perform fuzzy search with fuse.js
      const fuzzyOptions = {
        keys: ["title"],
        // Use a stricter threshold for short queries
        threshold: query.length === 1 ? 0.2 : 0.4,
        ignoreLocation: query.length > 1, // Use location for single characters
        location: 0,
        distance: query.length === 1 ? 10 : 100,
        minMatchCharLength: 1, // Allow single-character matching
      };

      const results = performFuzzySearch(searchableItems, query, fuzzyOptions);
      const appUsageStats = get(applicationUsageStats);

      // Use a higher score threshold for single character searches
      const minScore = query.length === 1 ? 60 : 30;

      // Convert back to ExtensionResult format
      return results
        .filter((item) => item.score > minScore) // Filter with adjusted threshold
        .map((item) => {
          // Apply usage boost to the score
          const usageCount = appUsageStats[item.title] || 0;
          const usageBoost = Math.min(15, Math.log2(usageCount + 1) * 5);

          return {
            score: item.score + usageBoost, // Boost score based on usage
            title: item.title,
            subtitle: "Application",
            type: "application",
            icon: "🖥️", // Application icon
            source: "application", // Add source information
            action: () => applicationService.open(item._app),
            usageCount, // Add usage count for debugging/transparency
          };
        });
    } catch (error) {
      logService.error(`Error in application fuzzy search: ${error}`);

      // Fall back to the standard search if fuzzy search fails
      try {
        // Update the application service's search method as well to handle single characters
        const appResults = await applicationService.search(query);
        return appResults.map((app) => ({
          score: app.score || 75,
          title: app.name,
          subtitle: "Application",
          type: "application",
          icon: "🖥️",
          source: "application",
          action: () => applicationService.open(app),
        }));
      } catch (fallbackError) {
        logService.error(`Fallback search also failed: ${fallbackError}`);
        return [];
      }
    }
  }

  /**
   * Get popular/default applications based on usage history
   */
  async getDefaultResults(): Promise<ExtensionResult[]> {
    try {
      // Ensure app cache is populated
      if (this.appCache.length === 0) {
        this.appCache = await applicationService.getAllApplications();
      }

      // Get usage statistics
      const usageStats = get(applicationUsageStats);

      // Combine usage data with app data
      const appsWithUsage = this.appCache.map((app) => {
        const usageCount = usageStats[app.name] || 0;
        return {
          ...app,
          usageCount,
          // Add recency boost if used in last 24 hours
          recencyBoost:
            applicationService.getLastUsedTimestamp(app.name) >
            Date.now() - 86400000
              ? 10
              : 0,
        };
      });

      // Sort by combined usage and recency score
      const sortedApps = appsWithUsage.sort((a, b) => {
        // Calculate combined score (usage count + recency boost)
        const scoreA = a.usageCount * 5 + (a.recencyBoost || 0);
        const scoreB = b.usageCount * 5 + (b.recencyBoost || 0);
        return scoreB - scoreA;
      });

      // Get top apps (with at least some recently/frequently used ones)
      const topApps = sortedApps.slice(0, 5);

      // Make sure we include at least 1-2 recently used apps even if they're not the most used overall
      const recentlyUsedApps = appsWithUsage
        .filter((app) => app.recencyBoost > 0)
        .sort((a, b) => {
          // Sort by recency (last used timestamp)
          return (
            applicationService.getLastUsedTimestamp(b.name) -
            applicationService.getLastUsedTimestamp(a.name)
          );
        })
        .slice(0, 2);

      // Combine the lists (unique by name)
      const combinedApps = [...topApps];
      for (const app of recentlyUsedApps) {
        if (!combinedApps.some((a) => a.name === app.name)) {
          combinedApps.push(app);
        }
      }

      // Convert to ExtensionResult format with usage-based scores
      return combinedApps.slice(0, 6).map((app) => {
        // Calculate score based on usage (60 base + up to 40 for usage)
        const usageBoost = Math.min(40, Math.log2(app.usageCount + 1) * 10);
        const recencyBoost = app.recencyBoost || 0;

        return {
          score: 60 + usageBoost + recencyBoost, // Base score + usage and recency boost
          title: app.name,
          subtitle: "Application",
          type: "application",
          icon: "🖥️",
          source: "application",
          action: () => applicationService.open(app),
          usageCount: app.usageCount,
          recentlyUsed: app.recencyBoost > 0,
        };
      });
    } catch (error) {
      logService.error(`Error getting default app results: ${error}`);
      return [];
    }
  }

  /**
   * Clear the app cache
   */
  clearCache(): void {
    this.appCache = [];
  }
}
