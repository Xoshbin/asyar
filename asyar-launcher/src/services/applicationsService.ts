import { openPath } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { info } from "@tauri-apps/plugin-log";
import type { AppResult } from "../types";

class ApplicationsService {
  private appCache: Map<string, string[]> = new Map();
  private lastUpdate: number = 0;
  private readonly CACHE_DURATION = 5000;

  private getAppName(path: string): string {
    const parts = path.split("/");
    return parts[parts.length - 1].replace(".app", "");
  }

  async refreshCache(): Promise<void> {
    try {
      const paths: string[] = await invoke("list_applications");
      this.appCache.clear();

      paths.forEach((path) => {
        const name = this.getAppName(path);
        if (!this.appCache.has(name)) {
          this.appCache.set(name, []);
        }
        this.appCache.get(name)!.push(path);
      });

      this.lastUpdate = Date.now();
    } catch (error) {
      info(`Failed to refresh application cache: ${String(error)}`);
    }
  }

  /**
   * Ensures the application cache is loaded and up-to-date
   */
  async ensureCacheLoaded(): Promise<void> {
    if (
      this.appCache.size === 0 ||
      Date.now() - this.lastUpdate > this.CACHE_DURATION
    ) {
      await this.refreshCache();
    }
  }

  async search(query: string): Promise<AppResult[]> {
    if (Date.now() - this.lastUpdate > this.CACHE_DURATION) {
      await this.refreshCache();
    }

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

  async open(app: AppResult): Promise<void> {
    try {
      invoke("hide");
      await openPath(app.path);
    } catch (error) {
      // If the first attempt fails, try the app name with .app extension
      try {
        const altPath = `/System/Applications/${app.name}.app`;
        invoke("hide");
        await openPath(altPath);
      } catch (retryError) {
        info(`Failed to open ${app.name}: ${error}`);
      }
    }
  }

  /**
   * Gets all applications without filtering
   * @returns All applications in the cache
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

export default new ApplicationsService();
