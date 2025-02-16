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
        });
      }
    });

    return results;
  }

  async open(app: AppResult): Promise<void> {
    try {
      info(`Attempting to open: ${app.path}`);
      await openPath(app.path);
      info(`Successfully opened: ${app.name}`);
    } catch (error) {
      // If the first attempt fails, try the app name with .app extension
      try {
        const altPath = `/System/Applications/${app.name}.app`;
        info(`Retrying with: ${altPath}`);
        await openPath(altPath);
        info(`Successfully opened: ${app.name}`);
      } catch (retryError) {
        info(`Failed to open ${app.name}: ${error}`);
      }
    }
  }
}

export default new ApplicationsService();
