import { openPath } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { LogService } from "./logService";
import type { AppResult } from "../types";
import type { IApplicationsService } from "./interfaces/IApplicationsService";

/**
 * Service for managing and interacting with system applications
 */
class ApplicationsService implements IApplicationsService {
  private appCache = new Map<string, string[]>();
  private lastUpdate = 0;
  private readonly CACHE_DURATION = 5000; // 5 seconds

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
    } catch (error) {
      LogService.error(`Failed to refresh application cache: ${error}`);
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
   */
  async search(query: string): Promise<AppResult[]> {
    await this.ensureCacheLoaded();

    const results: AppResult[] = [];
    const searchTerm = query.toLowerCase();

    this.appCache.forEach((paths, name) => {
      if (name.toLowerCase().includes(searchTerm)) {
        // Prefer /System/Applications path if available
        const bestPath =
          paths.find((p) => p.startsWith("/System/Applications")) || paths[0];

        results.push({
          name,
          path: bestPath,
          score: 0,
        });
      }
    });

    return results;
  }

  /**
   * Open an application
   */
  async open(app: AppResult): Promise<void> {
    try {
      invoke("hide"); // Hide the launcher window
      await openPath(app.path);
    } catch (error) {
      // If the first attempt fails, try the app name with .app extension
      try {
        const altPath = `/System/Applications/${app.name}.app`;
        invoke("hide");
        await openPath(altPath);
      } catch (retryError) {
        LogService.error(`Failed to open ${app.name}: ${error}`);
      }
    }
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

export default new ApplicationsService() as IApplicationsService;
