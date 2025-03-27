// src/services/applicationsService.ts
import { openPath } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import * as core from "@tauri-apps/api/core"; // Keep core import if used elsewhere
import { logService } from "./logService";
import type { AppResult } from "../types";
import type { IApplicationsService } from "./interfaces/IApplicationsService";
// Assuming Application type has 'id', 'name', 'path' and matches Rust model input needs
import type { Application } from "./search/types/Application"; // Import if needed for type checking
import type { SearchableItem } from "./search/types/SearchableItem"; // Import the union type

// Helper function to generate object IDs consistently (MUST match Rust logic)
// Make sure Application type has 'id' from invoke('list_applications')
const getAppObjectId = (app: {
  id: string;
  name: string;
  path: string;
}): string => `app_${app.id}`;

class ApplicationsService implements IApplicationsService {
  // No need for appCache if we fetch fresh on sync, unless cache is used elsewhere
  // private appCache = new Map<string, string[]>();
  private initialized = false;
  private allApps: { id: string; name: string; path: string }[] = []; // Store fetched apps

  async init(): Promise<void> {
    if (this.initialized) {
      logService.debug("ApplicationsService already initialized.");
      return;
    }
    logService.info("Initializing ApplicationsService...");
    try {
      // Perform initial sync on startup
      await this.syncApplicationIndex();
      this.initialized = true;
      logService.info("ApplicationsService initialized successfully.");
    } catch (error) {
      logService.error(`Failed to initialize applications service: ${error}`);
      // Decide if initialization failure is critical
    }
  }

  // Renamed from refreshAndIndexApplications to reflect sync logic
  private async syncApplicationIndex(): Promise<void> {
    logService.info("Starting application index synchronization...");
    try {
      // 1. Get current applications from Rust/System
      // IMPORTANT: Assuming invoke returns { id: string, name: string, path: string }[]
      const currentApps: { id: string; name: string; path: string }[] =
        await invoke("list_applications");
      this.allApps = currentApps; // Store for getAllApplications method
      const currentAppIds = new Set(currentApps.map(getAppObjectId));

      // 2. Get ALL indexed IDs from Rust and filter
      logService.debug("Fetching all indexed object IDs...");
      const allIndexedIds = new Set(
        await core.invoke<string[]>("get_indexed_object_ids")
      );
      const indexedAppIds = new Set<string>();
      allIndexedIds.forEach((id) => {
        if (id.startsWith("app_")) {
          indexedAppIds.add(id);
        }
      });
      logService.debug(
        `Found ${indexedAppIds.size} application IDs in the index.`
      );

      // 3. Compare and find differences
      const itemsToIndex: SearchableItem[] = [];
      const idsToDelete: string[] = [];

      // Find apps to index (in current apps but not in index)
      currentApps.forEach((app) => {
        if (!indexedAppIds.has(getAppObjectId(app))) {
          // Prepare the object matching the Rust SearchableItem::Application variant
          itemsToIndex.push({
            category: "application", // The discriminant tag
            id: app.id, // Use app name as ID for now "and it's better" since the id is not required from list apllications
            name: app.name,
            path: app.path,
          });
        }
        // Add logic here to check for UPDATED apps if necessary (e.g., compare paths)
        // If updated, add to itemsToIndex as well (Rust's index_item handles updates)
      });

      // Find IDs to delete (in index but not in current apps)
      indexedAppIds.forEach((indexedId) => {
        if (!currentAppIds.has(indexedId)) {
          idsToDelete.push(indexedId);
        }
      });

      logService.info(
        `Application Sync: ${itemsToIndex.length} items to index, ${idsToDelete.length} items to delete.`
      );

      // 4. Execute indexing and deletion tasks
      const indexPromises = itemsToIndex.map((item) =>
        core
          .invoke("index_item", { item })
          .catch((err) =>
            logService.error(`Failed indexing app ${item.name}: ${err}`)
          )
      );
      const deletePromises = idsToDelete.map((id) =>
        core
          .invoke("delete_item", { objectId: id })
          .catch((err) => logService.error(`Failed deleting app ${id}: ${err}`))
      );

      await Promise.all([...indexPromises, ...deletePromises]);

      logService.info("Application index synchronization completed.");
    } catch (error) {
      logService.error(`Failed to synchronize application index: ${error}`);
      // Rethrow or handle as appropriate for init process
      throw error;
    }
  }

  async open(app: AppResult): Promise<void> {
    // ... (open logic remains the same) ...
    try {
      invoke("hide"); // Hide the launcher window
      logService.info(
        `APPLICATION_OPENED: Application "${app.name}" opened, path: ${app.path}`
      );
      await openPath(app.path);
    } catch (error) {
      logService.error(`Failed to open ${app.name}: ${error}`);
      // Consider removing the retry logic if openPath handles variations
    }
  }

  // Updated to use the stored list; consider if a fresh fetch is needed sometimes
  public async getAllApplications(): Promise<AppResult[]> {
    if (!this.initialized) {
      // This ensures sync happens at least once before returning apps
      await this.init();
    }
    // Map the stored full app data to the expected AppResult format
    return this.allApps.map((app) => ({
      name: app.name,
      path: app.path,
      score: 0, // Add score if applicable later
      // Add other AppResult fields if needed
    }));
  }
}

export const applicationService: IApplicationsService =
  new ApplicationsService();
