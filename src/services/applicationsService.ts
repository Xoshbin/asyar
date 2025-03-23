import { openPath } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { logService } from "./logService";
import { searchService } from "./searchService";
import { ApplicationSearchProvider } from "./providers/ApplicationSearchProvider";
import type { AppResult } from "../types";
import type { IApplicationsService } from "./interfaces/IApplicationsService";
import { writable, get } from "svelte/store";

// Create stores for application usage statistics
export const applicationUsageStats = writable<Record<string, number>>({});
export const applicationLastUsed = writable<Record<string, number>>({});

/**
 * Service for managing and interacting with system applications
 */
class ApplicationsService implements IApplicationsService {
  private appCache = new Map<string, string[]>();
  private lastUpdate = 0;
  private readonly CACHE_DURATION = 5000; // 5 seconds
  private searchProvider = new ApplicationSearchProvider();
  private initialized = false;

  /**
   * Initialize the applications service
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      // Register with the search service
      searchService.registerProvider(this.searchProvider);

      // Initial cache population
      await this.refreshCache();

      // Load usage statistics from persistent storage
      await this.loadUsageStats();
      await this.loadLastUsedStats();

      this.initialized = true;
    } catch (error) {
      logService.error(`Failed to initialize applications service: ${error}`);
    }
  }

  /**
   * Load application usage statistics from storage
   */
  private async loadUsageStats(): Promise<void> {
    try {
      const stats = await invoke("get_usage_stats", { type: "applications" });
      if (stats && typeof stats === "object") {
        applicationUsageStats.set(stats as Record<string, number>);
      }
    } catch (error) {
      logService.error(`Failed to load application usage stats: ${error}`);
    }
  }

  /**
   * Load last used timestamps from storage
   */
  private async loadLastUsedStats(): Promise<void> {
    try {
      const stats = await invoke("get_usage_stats", { type: "app_last_used" });
      if (stats && typeof stats === "object") {
        applicationLastUsed.set(stats as Record<string, number>);
      }
    } catch (error) {
      logService.error(`Failed to load application last used stats: ${error}`);
      // Initialize with empty object if load fails
      applicationLastUsed.set({});
    }
  }

  /**
   * Save application usage statistics to storage
   */
  private async saveUsageStats(): Promise<void> {
    try {
      const stats = get(applicationUsageStats);
      await invoke("save_usage_stats", {
        type: "applications",
        data: stats,
      });

      const lastUsed = get(applicationLastUsed);
      await invoke("save_usage_stats", {
        type: "app_last_used",
        data: lastUsed,
      });
    } catch (error) {
      logService.error(`Failed to save application usage stats: ${error}`);
    }
  }

  /**
   * Extract app name from path
   */
  private getAppName(path: string): string {
    const parts = path.split("/");
    return parts[parts.length - 1].replace(".app", "");
  }

  /**
   * Refresh the application cache from the system
   */
  async refreshCache(): Promise<void> {
    try {
      const paths: string[] = await invoke("list_applications");
      this.appCache.clear();

      for (const path of paths) {
        const name = this.getAppName(path);
        if (!this.appCache.has(name)) {
          this.appCache.set(name, []);
        }
        this.appCache.get(name)!.push(path);
      }

      this.lastUpdate = Date.now();
      logService.debug(
        `Application cache refreshed with ${this.appCache.size} apps`
      );
    } catch (error) {
      logService.error(`Failed to refresh application cache: ${error}`);
    }
  }

  /**
   * Ensures the application cache is loaded and up-to-date
   */
  private async ensureCacheLoaded(): Promise<void> {
    const isCacheStale =
      this.appCache.size === 0 ||
      Date.now() - this.lastUpdate > this.CACHE_DURATION;

    if (isCacheStale) {
      await this.refreshCache();
    }
  }

  /**
   * Search for applications matching the query
   * This is used by the ApplicationSearchProvider
   */
  async search(query: string): Promise<AppResult[]> {
    await this.ensureCacheLoaded();

    const results: AppResult[] = [];
    const searchTerm = query.toLowerCase();

    // Don't exit early for single characters
    if (searchTerm) {
      this.appCache.forEach((paths, name) => {
        // For single character searches, only match at the start of the name
        const nameMatchesQuery =
          query.length === 1
            ? name.toLowerCase().startsWith(searchTerm)
            : name.toLowerCase().includes(searchTerm);

        if (nameMatchesQuery) {
          // Calculate a score based on how well the app name matches the query
          let score: number;

          if (name.toLowerCase() === searchTerm) {
            // Perfect match
            score = 100;
          } else if (name.toLowerCase().startsWith(searchTerm)) {
            // Starts with the query
            score = 90;
          } else {
            // Contains the query - score depends on position
            const position = name.toLowerCase().indexOf(searchTerm);
            score = Math.max(60, 85 - Math.min(position * 2, 25));
          }

          // Prefer /System/Applications path if available
          const bestPath =
            paths.find((p) => p.startsWith("/System/Applications")) || paths[0];

          results.push({
            name,
            path: bestPath,
            score: score,
          });
        }
      });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    // For single characters, return fewer results to avoid overwhelming the user
    const limit = query.length === 1 ? 5 : 10;
    return results.slice(0, limit);
  }

  /**
   * Open an application
   */
  async open(app: AppResult): Promise<void> {
    try {
      invoke("hide"); // Hide the launcher window

      const now = Date.now();

      // Update usage statistics before opening the app
      applicationUsageStats.update((stats) => {
        const key = app.name;
        stats[key] = (stats[key] || 0) + 1;
        return stats;
      });

      // Update last used timestamp
      applicationLastUsed.update((stats) => {
        stats[app.name] = now;
        return stats;
      });

      // Save the updated stats
      this.saveUsageStats();

      // Log the app usage
      logService.info(
        `APPLICATION_OPENED: Application "${app.name}" opened, path: ${app.path}`
      );

      await openPath(app.path);
    } catch (error) {
      // If the first attempt fails, try the app name with .app extension
      try {
        const altPath = `/System/Applications/${app.name}.app`;
        invoke("hide");
        await openPath(altPath);
      } catch (retryError) {
        logService.error(`Failed to open ${app.name}: ${error}`);
      }
    }
  }

  /**
   * Get the last used timestamp for an application
   */
  getLastUsedTimestamp(appName: string): number {
    const lastUsed = get(applicationLastUsed);
    return lastUsed[appName] || 0;
  }

  /**
   * Gets all applications without filtering
   */
  public async getAllApplications(): Promise<AppResult[]> {
    await this.ensureCacheLoaded();

    const allApps: AppResult[] = [];
    this.appCache.forEach((paths, name) => {
      allApps.push({
        name,
        path: paths[0],
        score: 0,
      });
    });

    return allApps;
  }
}

export const applicationService: IApplicationsService =
  new ApplicationsService();
