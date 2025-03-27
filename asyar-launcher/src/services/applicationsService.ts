import { openPath } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import * as core from "@tauri-apps/api/core";
import { logService } from "./logService";
import type { AppResult } from "../types";
import type { IApplicationsService } from "./interfaces/IApplicationsService";
import type { Application } from "./search/types/Application";

/**
 * Service for managing and interacting with system applications
 */
class ApplicationsService implements IApplicationsService {
  private appCache = new Map<string, string[]>();
  private initialized = false;

  /**
   * Initialize the applications service
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      // Initial cache population and indexing
      await this.refreshAndIndexApplications();
      this.initialized = true;
    } catch (error) {
      logService.error(`Failed to initialize applications service: ${error}`);
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
   * Refresh the application cache and index them
   */
  async refreshAndIndexApplications(): Promise<void> {
    try {
      const paths: string[] = await invoke("list_applications");
      this.appCache.clear();

      for (const path of paths) {
        const name = this.getAppName(path);
        if (!this.appCache.has(name)) {
          this.appCache.set(name, []);
        }
        this.appCache.get(name)!.push(path);

        // Index each application
        await this.indexApplication({
          name,
          path,
          type: "application",
        });
      }

      logService.debug(
        `Application cache refreshed and indexed ${this.appCache.size} apps`
      );
    } catch (error) {
      logService.error(`Failed to refresh and index applications: ${error}`);
    }
  }

  /**
   * Index an application in the search engine
   */
  private async indexApplication(appData: Application): Promise<void> {
    try {
      // Pass the appData object directly as the 'item' argument's value.
      // Ensure appData has the 'category' field required by the Rust enum tag.
      await core.invoke("index_item", {
        // The key here matches the argument name in Rust (`item`)
        // The value is the object Rust expects for SearchableItem
        item: {
          category: "application", // The tag for the enum
          name: appData.name, // Data for the Application variant
          path: appData.path, // Data for the Application variant
        },
        // Or, if your appData structure perfectly matches the expected JSON
        // (including the 'category' field at the top level):
        // item: appData
      });
      logService.debug(`Indexed application: ${appData.name}`);
    } catch (error) {
      logService.error(`Failed to index application ${appData.name}: ${error}`);
      console.error("Index application error details:", error);
    }
  }

  /**
   * Open an application
   */
  async open(app: AppResult): Promise<void> {
    try {
      invoke("hide"); // Hide the launcher window
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
   * Gets all applications without filtering
   */
  public async getAllApplications(): Promise<AppResult[]> {
    if (!this.initialized) {
      await this.init();
    }

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
