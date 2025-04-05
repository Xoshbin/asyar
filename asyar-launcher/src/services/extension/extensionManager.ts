import { writable, get } from "svelte/store";
import { searchQuery } from "../search/stores/search";
import { settingsService } from "../settings/settingsService";
import { exists, readDir, remove } from "@tauri-apps/plugin-fs";
import { join, resourceDir, appDataDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import type {
  Extension,
  ExtensionManifest,
  ExtensionResult,
  IExtensionManager,
  ExtensionCommand,
} from "asyar-api";
import { discoverExtensions, isBuiltInExtension } from "./extensionDiscovery"; // Re-added discoverExtensions
import { ExtensionBridge } from "asyar-api";
import { logService } from "../log/logService";
import { extensionLoaderService } from "../extensionLoaderService"; // Import the new loader service (correct path)
import { NotificationService } from "../notification/notificationService";
import { ClipboardHistoryService } from "../clipboard/clipboardHistoryService";
import { actionService } from "../action/actionService";
import { commandService } from "./commandService";
import { performanceService } from "../performance/performanceService";
import { viewManager, activeView, activeViewSearchable } from "./viewManager"; // Import the new view manager and its stores

// Import components
import {
  Button,
  Input,
  Card,
  Toggle,
  ShortcutRecorder,
  SplitView,
  ConfirmDialog,
} from "../../components";
import type { SearchableItem } from "../search/types/SearchableItem";
import { searchService } from "../search/SearchService";

// Stores for extension state
export const extensionUninstallInProgress = writable<string | null>(null);
// Removed: export const activeView = writable<string | null>(null);
// Removed: export const activeViewSearchable = writable<boolean>(false);
export const extensionUsageStats = writable<Record<string, number>>({}); // Keep usage stats here for now
export const extensionLastUsed = writable<Record<string, number>>({}); // Keep usage stats here for now

// Helper function to generate object IDs consistently (MUST match Rust logic)
const getCmdObjectId = (
  cmd: ExtensionCommand,
  manifest: ExtensionManifest
): string => `cmd_${cmd.id}`;
/**
 * Manages application extensions
 */
// Explicitly export the class for type imports
export class ExtensionManager implements IExtensionManager {
  private bridge = ExtensionBridge.getInstance();
  // Removed: private extensions: Extension[] = []; // Now managed via extensionsById
  private manifestsById: Map<string, ExtensionManifest> = new Map(); // Changed name for clarity
  private extensionManifestMap: Map<Extension, ExtensionManifest> = new Map(); // Keep for direct lookup if needed
  private extensionsById: Map<string, Extension> = new Map(); // Map ID to Extension instance
  private initialized = false;
  // Removed: private savedMainQuery = "";
  // Removed: currentExtension: Extension | null = null; // State now managed within viewManager or via lookup
  private allLoadedCommands: {
    cmd: ExtensionCommand;
    manifest: ExtensionManifest;
  }[] = [];

  // Getter to satisfy IExtensionManager interface based on viewManager state
  get currentExtension(): Extension | null {
    const currentView = viewManager.getActiveView();
    if (!currentView) return null;
    const extensionId = currentView.split("/")[0];
    return this.extensionsById.get(extensionId) || null;
  }

  constructor() {
    this.bridge.registerService("ExtensionManager", this);
    this.bridge.registerService("LogService", logService);
    this.bridge.registerService(
      "NotificationService",
      new NotificationService()
    );
    this.bridge.registerService(
      "ClipboardHistoryService",
      ClipboardHistoryService.getInstance()
    );
    this.bridge.registerService("ActionService", actionService);
    this.bridge.registerService("CommandService", commandService);

    this.bridge.registerComponent("Button", Button);
    this.bridge.registerComponent("Input", Input);
    this.bridge.registerComponent("Card", Card);
    this.bridge.registerComponent("Toggle", Toggle);
    this.bridge.registerComponent("SplitView", SplitView);
    this.bridge.registerComponent("ShortcutRecorder", ShortcutRecorder);
    this.bridge.registerComponent("ConfirmDialog", ConfirmDialog);
  }
  searchAll(query: string): Promise<ExtensionResult[]> {
    throw new Error("Method not implemented.");
  }

  async init(): Promise<boolean> {
    if (this.initialized) {
      logService.debug("ExtensionManager already initialized.");
      return true;
    }
    logService.custom("🔄 Initializing extension manager...", "EXTN", "blue");
    try {
      if (
        typeof performanceService.init === "function" &&
        !performanceService.init // Assuming performanceService.init is a function that returns a boolean indicating if initialized
      ) {
        await performanceService.init();
        logService.custom(
          "🔍 Performance monitoring initialized by extension manager",
          "PERF",
          "cyan"
        );
      }

      if (!settingsService.isInitialized()) {
        await settingsService.init();
      }

      performanceService.startTiming("extension-loading");
      await this.loadExtensions(); // This now uses the loader service internally
      const loadMetrics = performanceService.stopTiming("extension-loading");
      logService.custom(
        `🧩 Extensions loaded in ${loadMetrics.duration?.toFixed(2)}ms`,
        "PERF",
        "green"
      );

      // Initialize ViewManager *after* manifests are loaded
      viewManager.init(
        this.manifestsById,
        this.handleExtensionSearch.bind(this), // Pass bound methods as handlers
        this.handleExtensionViewActivated.bind(this),
        this.handleExtensionViewDeactivated.bind(this)
      );

      performanceService.startTiming("command-index-sync");
      await this.syncCommandIndex(); // Sync commands after extensions and view manager are ready
      const syncMetrics = performanceService.stopTiming("command-index-sync");
      logService.custom(
        `🔄 Commands index synced in ${syncMetrics.duration?.toFixed(2)}ms`,
        "PERF",
        "blue"
      );

      this.initialized = true;
      return true;
    } catch (error) {
      logService.error(`Failed to initialize extension manager: ${error}`);
      return false;
    }
  }

  public async handleCommandAction(commandObjectId: string): Promise<void> {
    logService.debug(`Handling command action for: ${commandObjectId}`);
    try {
      await commandService.executeCommand(commandObjectId);
      // --- Add usage recording ---
      logService.debug(`Recording usage for command: ${commandObjectId}`);
      invoke("record_item_usage", { objectId: commandObjectId })
        .then(() => logService.debug(`Usage recorded for ${commandObjectId}`))
        .catch((err) =>
          logService.error(
            `Failed to record usage for ${commandObjectId}: ${err}`
          )
        );
      // --- End usage recording ---
    } catch (error) {
      logService.error(
        `Error handling command action for ${commandObjectId}: ${error}`
      );
    }
  }

  private getCmdObjectId(
    cmd: ExtensionCommand,
    manifest: ExtensionManifest
  ): string {
    const commandId = cmd.id || "unknown_cmd";
    const extensionId = manifest.id || "unknown_ext";
    return `cmd_${extensionId}_${commandId}`;
  }

  private async syncCommandIndex(): Promise<void> {
    logService.info("Starting command index synchronization...");
    try {
      const currentCommands = this.allLoadedCommands;

      const currentCommandMap = new Map<
        string,
        { cmd: ExtensionCommand; manifest: ExtensionManifest }
      >();
      currentCommands.forEach((commandInfo) => {
        // Ensure manifest and cmd have IDs before creating objectId
        if (commandInfo.manifest?.id && commandInfo.cmd?.id) {
          const objectId = this.getCmdObjectId(
            commandInfo.cmd,
            commandInfo.manifest
          );
          currentCommandMap.set(objectId, commandInfo);
        } else {
          // Corrected warn call
          logService.warn(
            `Skipping command in sync due to missing ID in cmd or manifest: ${JSON.stringify(
              commandInfo
            )}`
          );
        }
      });
      const currentCommandIds = new Set(currentCommandMap.keys());

      const indexedCommandIds = await searchService.getIndexedObjectIds("cmd_");

      const itemsToIndex: SearchableItem[] = [];
      const idsToDelete: string[] = [];

      currentCommandMap.forEach(({ cmd, manifest }, objectId) => {
        // Double check IDs exist before pushing
        if (manifest.id && cmd.id) {
          itemsToIndex.push({
            category: "command",
            id: objectId,
            name: cmd.name,
            extension: manifest.id,
            trigger: cmd.trigger || cmd.name,
            type: cmd.resultType || manifest.type,
          });
        }
      });

      indexedCommandIds.forEach((indexedId) => {
        if (!currentCommandIds.has(indexedId)) {
          idsToDelete.push(indexedId);
        }
      });

      logService.info(
        `Command Sync: ${itemsToIndex.length} items to index, ${idsToDelete.length} items to delete.`
      );

      // Reverted to individual operations using Promise.all
      const indexPromises = itemsToIndex.map((item) =>
        searchService.indexItem(item)
      );
      const deletePromises = idsToDelete.map((id) =>
        searchService.deleteItem(id)
      );
      await Promise.all([...indexPromises, ...deletePromises]);

      logService.info("Command index synchronization completed.");
    } catch (error) {
      logService.error(`Failed to synchronize command index: ${error}`);
      throw error; // Re-throw? Or handle more gracefully?
    }
  }

  async unloadExtensions(): Promise<void> {
    // Clear commands first
    this.manifestsById.forEach((manifest) => {
      if (manifest && manifest.id) {
        // Check manifest and id exist
        commandService.clearCommandsForExtension(manifest.id);
      }
    });

    // Deactivate extensions via bridge
    await this.bridge.deactivateExtensions();

    // Clear internal state
    this.extensionsById.clear();
    this.manifestsById.clear();
    this.extensionManifestMap.clear();
    this.allLoadedCommands = [];
    this.initialized = false; // Mark as uninitialized

    // Reset view manager state if needed (goBack handles most of it)
    if (viewManager.isViewActive()) {
      // Keep calling goBack until the stack is empty to ensure proper state reset
      while (viewManager.getNavigationStackSize() > 0) {
        viewManager.goBack();
      }
    }

    logService.info("Extensions unloaded and state cleared.");
  }

  // Updated loadExtensions to use the service
  async loadExtensions() {
    logService.debug(
      "Starting loadExtensions process using extensionLoaderService..."
    );
    try {
      // Clear previous state before loading
      this.extensionsById.clear();
      this.manifestsById.clear();
      this.extensionManifestMap.clear();
      this.allLoadedCommands = [];

      // Use the loader service
      const loadedExtensionsMap =
        await extensionLoaderService.loadAllExtensions();

      let enabledCount = 0;
      let disabledCount = 0;

      // Process the loaded extensions provided by the service
      for (const [
        id,
        { extension, manifest },
      ] of loadedExtensionsMap.entries()) {
        // Check if the loaded extension should be enabled
        const isBuiltIn = isBuiltInExtension(id);
        const isEnabled = isBuiltIn || settingsService.isExtensionEnabled(id);

        if (isEnabled) {
          // Extension is loaded and enabled, proceed with registration
          performanceService.trackExtensionLoadStart(manifest.id); // Use manifest ID for tracking
          // Store by ID
          this.extensionsById.set(id, extension);
          this.manifestsById.set(id, manifest);
          this.extensionManifestMap.set(extension, manifest); // Keep this map if needed

          // Register with bridge
          this.bridge.registerManifest(manifest);
          this.bridge.registerExtensionImplementation(id, extension);

          // Collect commands
          if (manifest.commands) {
            manifest.commands.forEach((cmd) => {
              if (cmd && cmd.id) {
                // Ensure command and its ID exist
                this.allLoadedCommands.push({ cmd, manifest });
              } else {
                logService.warn(
                  `Skipping command due to missing ID in manifest: ${manifest.id}`
                );
              }
            });
          }
          performanceService.trackExtensionLoadEnd(manifest.id);
          enabledCount++;
        } else {
          logService.debug(`Extension ${id} is loaded but disabled.`);
          disabledCount++;
        }
      }

      // Initialize and activate extensions via the bridge *after* processing all loaded ones
      if (enabledCount > 0) {
        performanceService.startTiming("extension-initialization-activation");
        await this.bridge.initializeExtensions();
        await this.bridge.activateExtensions();
        performanceService.stopTiming("extension-initialization-activation");
        this.registerCommandHandlersFromManifests(); // Register handlers only after activation
      } else {
        logService.debug("No enabled extensions to initialize or activate.");
      }

      logService.debug(
        `Extensions loading complete: ${enabledCount} enabled, ${disabledCount} disabled`
      );
    } catch (error) {
      logService.error(`Failed during loadExtensions processing: ${error}`);
      // Ensure state is cleared on error
      this.extensionsById.clear();
      this.manifestsById.clear();
      this.extensionManifestMap.clear();
      this.allLoadedCommands = [];
    }
  }

  private registerCommandHandlersFromManifests(): void {
    logService.debug(
      `Registering command handlers for ${this.allLoadedCommands.length} loaded commands.`
    );
    this.allLoadedCommands.forEach(({ cmd, manifest }) => {
      try {
        // Find the extension instance using the manifest ID
        const extension = this.extensionsById.get(manifest.id);
        if (!extension) {
          logService.warn(
            `Could not find loaded extension instance for ID: ${manifest.id} while registering command: ${cmd.id}`
          );
          return; // Skip if extension instance not found
        }

        // Ensure cmd and manifest IDs exist
        if (!cmd.id || !manifest.id) {
          logService.warn(
            `Skipping command registration due to missing ID in cmd or manifest.`
          );
          return;
        }

        const fullObjectId = this.getCmdObjectId(cmd, manifest);
        const shortCmdId = cmd.id;

        const handler = {
          execute: async (args?: Record<string, any>) => {
            // Add try-catch around the actual execution within the handler
            try {
              return await extension.executeCommand(shortCmdId, args);
            } catch (execError) {
              logService.error(
                `Error executing command ${shortCmdId} in extension ${manifest.id}: ${execError}`
              );
              // Optionally re-throw or return an error indicator
              throw execError;
            }
          },
        };
        commandService.registerCommand(fullObjectId, handler, manifest.id);

        logService.debug(
          `Registered handler for command: ${shortCmdId} (ID: ${fullObjectId}) for extension: ${manifest.id}`
        );
      } catch (error) {
        logService.error(
          `Error registering handler for command ${
            cmd?.id || "unknown"
          } of extension ${manifest?.id || "unknown"}: ${error}`
        );
      }
    });
    logService.info(
      `Finished registering command handlers for enabled extensions.`
    );
  }

  // Removed: private async loadExtensionWithManifest(...) - Logic moved to extensionLoaderService

  // --- Methods delegated to ViewManager ---

  navigateToView(viewPath: string): void {
    logService.info(`[ExtensionManager] navigateToView called with path: ${viewPath}`); // <-- Added log
    // Update usage stats before navigating
    const extensionId = viewPath.split("/")[0];
    const manifest = this.manifestsById.get(extensionId);
    if (manifest && manifest.id) {
      // Ensure manifest and ID exist
      logService.info(
        `Extension view opened: ${viewPath} for extension: ${manifest.id}`
      );
      const now = Date.now();
      // Ensure stats update correctly even if entry doesn't exist
      extensionUsageStats.update((stats) => {
        const currentCount = stats[manifest.id!] || 0;
        return { ...stats, [manifest.id!]: currentCount + 1 };
      });
      extensionLastUsed.update((stats) => ({ ...stats, [manifest.id!]: now }));
    } else {
      logService.warn(
        `Could not find manifest for ID ${extensionId} while updating usage stats.`
      );
    }
    // Delegate to viewManager
    viewManager.navigateToView(viewPath);
  }

  // Renamed from closeView to match interface
  goBack(): void {
    viewManager.goBack(); // Delegate to viewManager
  }

  handleViewSearch(query: string): Promise<void> {
    // This is now primarily handled by viewManager calling the registered handler
    return viewManager.handleViewSearch(query);
  }

  // --- Internal handlers passed to ViewManager ---

  private async handleExtensionSearch(query: string): Promise<void> {
    const currentView = viewManager.getActiveView();
    if (!currentView) return;

    const extensionId = currentView.split("/")[0];
    const extension = this.extensionsById.get(extensionId);

    if (extension && typeof extension.onViewSearch === "function") {
      try {
        await extension.onViewSearch(query);
      } catch (error) {
        logService.error(
          `Error during onViewSearch in extension ${extensionId}: ${error}`
        );
      }
    } else if (extension) {
      logService.debug(
        `onViewSearch not implemented by extension ${extensionId}`
      );
    } else {
      logService.warn(
        `Extension not found for ID: ${extensionId} during view search.`
      );
    }
  }

  private handleExtensionViewActivated(
    extensionId: string,
    viewPath: string
  ): void {
    const extension = this.extensionsById.get(extensionId);
    if (extension && typeof extension.viewActivated === "function") {
      try {
        extension.viewActivated(viewPath);
      } catch (error) {
        logService.error(
          `Error during viewActivated for ${extensionId}: ${error}`
        );
      }
    }
  }

  private handleExtensionViewDeactivated(
    extensionId: string | null,
    viewPath: string | null
  ): void {
    if (!extensionId || !viewPath) return; // Nothing to deactivate if no extension was active

    const extension = this.extensionsById.get(extensionId);
    if (extension && typeof extension.viewDeactivated === "function") {
      try {
        extension.viewDeactivated(viewPath);
      } catch (error) {
        logService.error(
          `Error during viewDeactivated for ${extensionId}: ${error}`
        );
      }
    }
  }

  // --- Existing Methods (potentially adapted) ---

  isExtensionEnabled(extensionId: string): boolean {
    // Parameter changed to ID
    // Built-in extensions are always considered enabled
    if (isBuiltInExtension(extensionId)) {
      return true;
    }
    return settingsService.isExtensionEnabled(extensionId);
  }

  async toggleExtensionState(
    extensionId: string, // Parameter changed to ID
    enabled: boolean
  ): Promise<boolean> {
    // Prevent disabling built-in extensions
    if (isBuiltInExtension(extensionId) && !enabled) {
      logService.warn(`Cannot disable built-in extension: ${extensionId}`);
      return false;
    }

    try {
      // Use ID for settings update
      const success = await settingsService.updateExtensionState(
        extensionId,
        enabled
      );
      if (success) {
        logService.info(
          `Extension '${extensionId}' state set to ${
            enabled ? "enabled" : "disabled"
          }. Reloading extensions...`
        );
        // Reloading sequence remains the same
        await this.unloadExtensions();
        await this.loadExtensions(); // This will re-initialize viewManager with new manifests
        await this.syncCommandIndex();
      }
      return success;
    } catch (error) {
      logService.error(
        `Failed to toggle extension state for '${extensionId}': ${error}`
      );
      return false;
    }
  }

  async getAllExtensionsWithState(): Promise<any[]> {
    // Keep returning manifest-like structure for settings UI
    try {
      const discoveredIds = await discoverExtensions(); // Re-added discoverExtensions call
      const allExtensionsData: Array<any> = [];

      for (const id of discoveredIds) {
        try {
          // Determine path based on built-in or regular
          const isBuiltIn = isBuiltInExtension(id);
          // Use the loader service's single load logic to get manifest reliably
          const loaded = await extensionLoaderService.loadSingleExtension(id);

          if (loaded && loaded.manifest) {
            const manifest = loaded.manifest;
            allExtensionsData.push({
              title: manifest.name,
              subtitle: manifest.description || "",
              type: manifest.type || "unknown",
              keywords:
                manifest.commands
                  ?.map((cmd: any) => cmd.trigger || cmd.name)
                  .join(" ") || "",
              enabled:
                isBuiltIn || settingsService.isExtensionEnabled(manifest.id), // Use ID for check
              id: manifest.id, // Use ID from manifest
              version: manifest.version || "N/A",
              isBuiltIn: isBuiltIn, // Add flag for UI differentiation
            });
          } else if (!isBuiltIn) {
            // Only warn if not built-in and loading failed
            // Warning/debug log handled within loadSingleExtension
          }
        } catch (error) {
          logService.warn(
            `Error processing potential extension ${id} in getAllExtensionsWithState: ${error}`
          );
        }
      }
      // Sort built-in first, then alphabetically by title
      allExtensionsData.sort((a, b) => {
        if (a.isBuiltIn && !b.isBuiltIn) return -1;
        if (!a.isBuiltIn && b.isBuiltIn) return 1;
        return a.title.localeCompare(b.title);
      });
      return allExtensionsData;
    } catch (error) {
      logService.error(`Error retrieving all extensions with state: ${error}`);
      return [];
    }
  }

  async getAllExtensions(): Promise<any[]> {
    // This seems deprecated or for a specific UI use case?
    logService.warn(
      "getAllExtensions is potentially deprecated or UI-specific. Returning data based on currently loaded *enabled* manifests."
    );
    const allItems: any[] = [];
    this.manifestsById.forEach((manifest) => {
      // Iterate loaded manifests
      // Check if it's actually enabled (should be, as we only load enabled ones, but double-check)
      const isBuiltIn = isBuiltInExtension(manifest.id); // Use helper function
      if (isBuiltIn || this.isExtensionEnabled(manifest.id)) {
        allItems.push({
          title: manifest.name, // Assuming name exists based on previous checks
          subtitle: manifest.description,
          keywords:
            manifest.commands
              ?.map((cmd) => cmd.trigger || cmd.name)
              .join(" ") || "",
          type: manifest.type,
          action: () => {
            // Action now uses navigateToView
            if (manifest.type === "view" && manifest.defaultView) {
              this.navigateToView(`${manifest.id}/${manifest.defaultView}`);
            } else {
              // Maybe trigger first command or show info?
              logService.info(
                `Default action triggered for non-view/commandless extension: ${manifest.id}`
              );
            }
          },
        });
      }
    });
    return allItems;
  }

  async uninstallExtension(
    extensionId: string // Now consistently uses ID
  ): Promise<boolean> {
    logService.info(`Attempting to uninstall extension ID: ${extensionId}`);
    // Find manifest name for settings removal (if needed, though ID is preferred)
    // Try loading manifest specifically for uninstall info if not already loaded
    const manifest =
      this.manifestsById.get(extensionId) ||
      (await this.tryLoadManifestForUninstall(extensionId));
    const extensionName = manifest?.name; // May be undefined if manifest load failed

    try {
      extensionUninstallInProgress.set(extensionId);

      // Prevent uninstalling built-in extensions
      if (isBuiltInExtension(extensionId)) {
        logService.error(`Cannot uninstall built-in extension: ${extensionId}`);
        return false;
      }

      // Use ID for disabling/removing settings state
      if (settingsService.isExtensionEnabled(extensionId)) {
        logService.debug(
          `Disabling extension '${extensionId}' before uninstall.`
        );
        await settingsService.updateExtensionState(extensionId, false);
      }

      const extensionsDir = await this.getExtensionsDirectory();
      const extensionPath = await join(extensionsDir, extensionId); // Use ID for path

      // Safety check remains the same
      if (!extensionPath.includes("extensions") || extensionId.includes("..")) {
        throw new Error(
          `Safety check failed: Invalid path derived for ${extensionId}`
        );
      }

      const pathExists = await exists(extensionPath);
      if (!pathExists) {
        logService.warn(
          `Extension directory not found at ${extensionPath}. Skipping deletion.`
        );
      } else {
        logService.debug(`Attempting to delete directory: ${extensionPath}`);
        await remove(extensionPath, { recursive: true });
        logService.info(`Successfully deleted directory: ${extensionPath}`);
      }

      // Remove settings state using ID
      await settingsService.removeExtensionState(extensionId);
      logService.debug(`Removed settings for extension ID: ${extensionId}`);

      // Reloading sequence remains the same
      logService.info(
        "Reloading extensions and re-syncing index after uninstall..."
      );
      await this.unloadExtensions();
      await this.loadExtensions();
      await this.syncCommandIndex();

      logService.info(
        `Extension ${extensionId} ${
          extensionName ? `(${extensionName})` : ""
        } uninstalled successfully.`
      );
      return true;
    } catch (error) {
      logService.error(
        `Failed to uninstall extension ${extensionId} ${
          extensionName ? `(${extensionName})` : ""
        }: ${error}`
      );
      return false;
    } finally {
      extensionUninstallInProgress.set(null);
    }
  }

  /**
   * Calls the search method on all enabled extensions and aggregates results.
   */
  async searchAllExtensions(query: string): Promise<ExtensionResult[]> {
    const allResults: ExtensionResult[] = [];
    const searchPromises: Promise<ExtensionResult[]>[] = [];

    logService.debug(
      `Calling search() on ${this.extensionsById.size} loaded extensions for query: "${query}"`
    );

    this.extensionsById.forEach((extension, id) => {
      // Check if extension is enabled and has a search method
      if (
        this.isExtensionEnabled(id) &&
        typeof extension.search === "function"
      ) {
        searchPromises.push(
          Promise.resolve() // Ensure it's always a promise
            .then(() => extension.search(query))
            .then((results) => {
              // Add extensionId to each result for context if needed later
              return results.map((res) => ({ ...res, extensionId: id }));
            })
            .catch((error) => {
              logService.error(`Error searching in extension ${id}: ${error}`);
              return []; // Return empty array on error for this extension
            })
        );
      }
    });

    try {
      const resultsArrays = await Promise.all(searchPromises);
      resultsArrays.forEach((results) => allResults.push(...results));
      logService.debug(
        `Aggregated ${allResults.length} results from extension search() methods.`
      );
      // Sort results by score (descending)
      allResults.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      return allResults;
    } catch (error) {
      logService.error(`Error aggregating extension search results: ${error}`);
      return []; // Return empty on overall aggregation error
    }
  }

  // New helper function specifically for dynamic manifest import
  private async _dynamicImportManifest(
    manifestPath: string
  ): Promise<any | null> {
    try {
      // @ts-ignore - Suppressing persistent error on this dynamic import line
      return await import(/* @vite-ignore */ manifestPath);
    } catch (importError) {
      logService.warn(
        `Dynamic import failed for manifest ${manifestPath}: ${
          importError instanceof Error ? importError.message : importError
        }`
      );
      return null;
    }
  }

  // Helper to try loading manifest just for getting name during uninstall if not already loaded
  private async tryLoadManifestForUninstall(
    extensionId: string
  ): Promise<ExtensionManifest | null> {
    try {
      const isBuiltIn = isBuiltInExtension(extensionId);
      if (isBuiltIn) return null; // Should not happen due to earlier check, but safe guard

      const basePath = `../../extensions/${extensionId}`;
      const manifestPath = `${basePath}/manifest.json`;

      // Use the new helper function
      const manifestModule = await this._dynamicImportManifest(manifestPath);

      if (manifestModule && typeof manifestModule === "object") {
        // Check for default export first
        const defaultExport = manifestModule.default;
        if (
          defaultExport &&
          typeof defaultExport === "object" &&
          defaultExport.id &&
          defaultExport.name
        ) {
          return defaultExport as ExtensionManifest;
        }

        // Check if the module itself is the manifest
        if (manifestModule.id && manifestModule.name) {
          return manifestModule as ExtensionManifest;
        }

        // If neither looks like a manifest
        logService.warn(
          `Imported module for ${extensionId} manifest doesn't seem to contain a valid manifest object.`
        );
      }
      return null; // Return null if module is not an object or no valid manifest found
    } catch (e) {
      // Log general error during the process
      logService.error(
        `Error in tryLoadManifestForUninstall for ${extensionId}: ${
          e instanceof Error ? e.message : e
        }`
      );
      return null;
    }
  }

  private async getExtensionsDirectory(): Promise<string> {
    try {
      const isDev = import.meta.env?.DEV === true; // Check for development mode
      let basePath: string;
      if (isDev) {
        // In dev, extensions are likely siblings to src, adjust path accordingly
        basePath = await resourceDir(); // resourceDir points to src-tauri/target/debug usually
        // Go up levels to reach project root, then down to extensions
        // This might need adjustment based on exact dev setup
        const projectRoot = await join(basePath, "..", "..", ".."); // Adjust based on target dir depth
        logService.warn(
          `Using development path for extensions relative to project root: ${projectRoot}`
        );
        return await join(projectRoot, "extensions");
      } else {
        // In production, use appDataDir
        basePath = await appDataDir();
        return await join(basePath, "extensions");
      }
    } catch (error) {
      logService.error(`Failed to get base directory: ${error}. Falling back.`);
      try {
        // Fallback might be less reliable
        const resourceDirectory = await resourceDir();
        return await join(resourceDirectory, "_up_/", "extensions"); // Tauri's way to reference relative paths in prod
      } catch (fallbackError) {
        logService.error(
          `Fallback to resource directory failed: ${fallbackError}. Cannot determine extensions directory.`
        );
        throw new Error("Could not determine extensions directory.");
      }
    }
  }

  // Removed: getExtensionId(extension: Extension): string | undefined
  // Use extensionsById map instead if needed: this.extensionsById.get(id) -> Extension
}

const extensionManagerInstance = new ExtensionManager();
export default extensionManagerInstance;

// Re-export view stores for backward compatibility or direct use
export { activeView, activeViewSearchable };
