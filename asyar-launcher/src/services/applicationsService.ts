// src/services/applicationsService.ts
import { openPath } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { logService } from "./logService";
import type { IApplicationsService } from "./interfaces/IApplicationsService";
import type { Application } from "./search/types/Application"; // Import if needed for type checking
import type { SearchableItem } from "./search/types/SearchableItem";
import { searchService } from "./search/SearchService";
import type { SearchResult } from "./search/interfaces/SearchResult";
// Import the search service instance

class ApplicationsService implements IApplicationsService {
  private initialized = false;
  // Store the full Application object including the ID from list_applications
  private allApps: Application[] = [];

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
    // ... (init logic remains the same) ...
  }

  // Modified syncApplicationIndex
  private async syncApplicationIndex(): Promise<void> {
    logService.info("Starting application index synchronization...");
    try {
      // 1. Get current applications from Rust (app.id is now the full "app_...")
      const currentApps: Application[] = await invoke("list_applications");
      this.allApps = currentApps;

      // Create map keyed by the full object ID (which is now directly in app.id)
      const currentAppMap = new Map<string, Application>();
      currentApps.forEach((app) => {
        // --- Use app.id directly as the key ---
        logService.debug(`Found application: ${app.name}, Full ID: ${app.id}`);
        currentAppMap.set(app.id, app); // app.id is the key
      });
      const currentAppIds = new Set(currentAppMap.keys()); // Set of full object IDs

      // 2. Get indexed IDs (these are also full object IDs)
      const indexedAppIds = await searchService.getIndexedObjectIds("app_");

      // 3. Compare
      const itemsToIndex: SearchableItem[] = [];
      const idsToDelete: string[] = [];

      currentAppMap.forEach((app, objectId) => {
        // objectId and app.id are the same here
        if (!indexedAppIds.has(objectId)) {
          // --- Send the FULL ID as the 'id' field for indexing ---
          itemsToIndex.push({
            category: "application",
            id: app.id, // Pass the full ID ("app_...")
            name: app.name,
            path: app.path,
          });
        }
      });

      indexedAppIds.forEach((indexedId) => {
        // indexedId is "app_..."
        if (!currentAppIds.has(indexedId)) {
          idsToDelete.push(indexedId); // Delete using the full ID "app_..."
        }
      });

      logService.info(
        `Application Sync: ${itemsToIndex.length} items to index, ${idsToDelete.length} items to delete.`
      );

      // 4. Execute tasks
      const indexPromises = itemsToIndex.map(
        (item) => searchService.indexItem(item) // indexItem now receives the full ID in item.id
      );
      const deletePromises = idsToDelete.map(
        (id) => searchService.deleteItem(id) // deleteItem receives the full ID
      );

      await Promise.all([...indexPromises, ...deletePromises]);

      logService.info("Application index synchronization completed.");
    } catch (error) {
      logService.error(`Failed to synchronize application index: ${error}`);
      throw error;
    }
  }

  async open(app: SearchResult): Promise<void> {
    try {
      invoke("hide"); // Hide the launcher window
      logService.info(
        `APPLICATION_OPENED: Application "${app.name}" opened, path: ${app.path}`
      );
      // Check if app.path is defined before opening it
      if (app.path) {
        await openPath(app.path);
      } else {
        logService.error(`Failed to open ${app.name}: path is undefined`);
        return;
      }
      // This check still needs objectId to be passed correctly from page.svelte
      if (app.objectId && !app.objectId.startsWith("missing_id_")) {
        logService.debug(
          `Recording usage for item: ${app.name} (ID: ${app.objectId})` // Updated log message slightly
        );
        invoke("record_item_usage", { objectId: app.objectId })
          .then(() => logService.debug(`Usage recorded for ${app.objectId}`))
          .catch((err) =>
            logService.error(
              `Failed to record usage for ${app.objectId}: ${err}`
            )
          );
      } else {
        // Log if ID is missing or is the fallback ID
        logService.warn(
          `Cannot record usage: valid objectId missing for selected item ${app.name}`
        );
      }
    } catch (error) {
      logService.error(`Failed to open ${app.name}: ${error}`);
    }
  }
}

export const applicationService: IApplicationsService =
  new ApplicationsService();
