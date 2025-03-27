import { writable, get } from "svelte/store";
import { searchQuery } from "../stores/search";
import { settingsService } from "./settingsService";
import { exists, readDir, remove } from "@tauri-apps/plugin-fs";
import { join, resourceDir, appDataDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import type {
  Extension,
  ExtensionManifest,
  ExtensionResult, // Note: This type might not be used directly anymore if focusing on SearchResult
  IExtensionManager,
  ExtensionCommand,
} from "asyar-api";
import { discoverExtensions } from "./extensionDiscovery";
import { ExtensionBridge } from "asyar-api";
import { logService } from "./logService";
import { NotificationService } from "./notificationService";
import { ClipboardHistoryService } from "./clipboardHistoryService";
import { actionService } from "./actionService";
import { commandService } from "./commandService";
import { performanceService } from "./performanceService";

// Import components
import {
  Button,
  Input,
  Card,
  Toggle,
  ShortcutRecorder,
  SplitView,
  ConfirmDialog,
} from "../components";
// Removed 'Command' import as it's not used directly here after removing old indexing
// import type { Command } from "./search/types/Command";
import type { SearchableItem } from "./search/types/SearchableItem";
import { searchService } from "./search/SearchService";

// Stores for extension state
export const extensionUninstallInProgress = writable<string | null>(null);
export const activeView = writable<string | null>(null);
export const activeViewSearchable = writable<boolean>(false);
export const extensionUsageStats = writable<Record<string, number>>({});
export const extensionLastUsed = writable<Record<string, number>>({});

// Helper function to generate object IDs consistently (MUST match Rust logic)
const getCmdObjectId = (
  cmd: ExtensionCommand,
  manifest: ExtensionManifest
): string => `cmd_${cmd.id}`; // Assuming cmd has a unique id within extension
/**
 * Manages application extensions
 */
class ExtensionManager implements IExtensionManager {
  // Implement interface if defined
  private bridge = ExtensionBridge.getInstance();
  private extensions: Extension[] = [];
  private manifests: Map<string, ExtensionManifest> = new Map();
  private extensionManifestMap: Map<Extension, ExtensionManifest> = new Map();
  private initialized = false;
  private savedMainQuery = "";
  currentExtension: Extension | null = null; // Use specific type if possible
  private allLoadedCommands: {
    cmd: ExtensionCommand;
    manifest: ExtensionManifest;
  }[] = [];

  constructor() {
    // --- Service & Component Registrations (Required) ---
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
    // --- End Registrations ---
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
      // Use a more robust check for performanceService initialization
      if (
        typeof performanceService.init === "function" &&
        !performanceService.init
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
      await this.loadExtensions(); // Populates this.allLoadedCommands
      const loadMetrics = performanceService.stopTiming("extension-loading");
      logService.custom(
        `🧩 Extensions loaded in ${loadMetrics.duration?.toFixed(2)}ms`,
        "PERF",
        "green"
      );

      // Sync index *after* loading enabled commands
      performanceService.startTiming("command-index-sync");
      await this.syncCommandIndex(); // Performs comparison and indexing/deletion
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

  private async syncCommandIndex(): Promise<void> {
    logService.info("Starting command index synchronization...");
    try {
      // 1. Get current commands (from enabled extensions)
      const currentCommands = this.allLoadedCommands; // Assumes this is populated correctly

      // Create map and set of current command object IDs
      const currentCommandMap = new Map<
        string,
        { cmd: ExtensionCommand; manifest: ExtensionManifest }
      >();
      currentCommands.forEach((commandInfo) => {
        currentCommandMap.set(
          getCmdObjectId(commandInfo.cmd, commandInfo.manifest),
          commandInfo
        );
      });
      const currentCommandIds = new Set(currentCommandMap.keys());

      // 2. Get indexed command IDs using SearchService
      const indexedCommandIds = await searchService.getIndexedObjectIds("cmd_");

      // 3. Compare and find differences
      const itemsToIndex: SearchableItem[] = [];
      const idsToDelete: string[] = [];

      // Find commands to index (or update)
      currentCommandMap.forEach(({ cmd, manifest }, objectId) => {
        // Index if new OR always re-index to handle updates (simpler)
        // if (!indexedCommandIds.has(objectId)) { // Only index if NEW
        itemsToIndex.push({
          category: "command",
          // Use a stable ID for the command itself. If cmd.id is unique *across all extensions*, use it.
          // If not, combine extension ID and command ID.
          // Let's assume cmd.id is unique within the extension. Rust side uses this to build object_id.
          id: cmd.id,
          name: cmd.name,
          extension: manifest.id,
          trigger: cmd.trigger || cmd.name,
          // Ensure 'type' here matches the expected 'command_type' field in Rust's Command struct
          type: manifest.type, // Use the correct field from manifest
        });
        // }
      });

      // Find command IDs to delete (in index but not in current enabled commands)
      indexedCommandIds.forEach((indexedId) => {
        if (!currentCommandIds.has(indexedId)) {
          idsToDelete.push(indexedId);
        }
      });

      logService.info(
        `Command Sync: ${itemsToIndex.length} items to index, ${idsToDelete.length} items to delete.`
      );

      // 4. Execute indexing and deletion tasks USING SearchService
      const indexPromises = itemsToIndex.map(
        (item) => searchService.indexItem(item) // Delegate to searchService
      );
      const deletePromises = idsToDelete.map(
        (id) => searchService.deleteItem(id) // Delegate to searchService
      );

      await Promise.all([...indexPromises, ...deletePromises]);

      logService.info("Command index synchronization completed.");
    } catch (error) {
      logService.error(`Failed to synchronize command index: ${error}`);
      throw error; // Rethrow or handle
    }
  }

  async unloadExtensions(): Promise<void> {
    // Clean up any registered commands from commandService
    for (const extension of this.extensions) {
      const manifest = this.extensionManifestMap.get(extension);
      if (manifest) {
        commandService.clearCommandsForExtension(manifest.id);
      }
    }
    // Deactivate extensions via the bridge
    await this.bridge.deactivateExtensions();
    // Clear internal state related to loaded extensions
    this.extensions = [];
    this.manifests.clear();
    this.extensionManifestMap.clear();
    this.allLoadedCommands = [];
    this.initialized = false; // Mark as uninitialized
    logService.info("Extensions unloaded and state cleared.");
  }

  async loadExtensions() {
    try {
      performanceService.startTiming("extension-discovery");
      const extensionIds = await discoverExtensions();
      // ... (discovery logging) ...

      // Clear existing state before loading
      this.extensions = [];
      this.manifests.clear();
      this.extensionManifestMap.clear();
      this.allLoadedCommands = []; // Clear list before populating

      const extensionPairs = await Promise.all(
        extensionIds.map((id) =>
          this.loadExtensionWithManifest(`../extensions/${id}`)
        )
      );

      let enabledCount = 0;
      let disabledCount = 0;
      for (const [extension, manifest] of extensionPairs) {
        if (extension && manifest) {
          const isEnabled = settingsService.isExtensionEnabled(manifest.name);
          if (isEnabled) {
            performanceService.trackExtensionLoadStart(manifest.id);
            this.extensions.push(extension);
            this.manifests.set(manifest.name, manifest); // Keep for enabling/disabling by name
            this.extensionManifestMap.set(extension, manifest); // Keep for mapping instance to manifest
            this.bridge.registerManifest(manifest);
            this.bridge.registerExtensionImplementation(manifest.id, extension);

            // Store commands from enabled extensions for later sync and handler registration
            if (manifest.commands) {
              manifest.commands.forEach((cmd) => {
                // Keep commandMap for potential direct lookup if needed elsewhere
                // Add to list used for sync and handler registration
                this.allLoadedCommands.push({ cmd, manifest });
              });
            }
            performanceService.trackExtensionLoadEnd(manifest.id);
            enabledCount++;
          } else {
            disabledCount++;
          }
        }
      }

      performanceService.startTiming("extension-initialization");
      await this.bridge.initializeExtensions();
      await this.bridge.activateExtensions();
      performanceService.stopTiming("extension-initialization");

      // Register only command *handlers*, no indexing here
      this.registerCommandHandlersFromManifests();

      logService.debug(
        `Extensions loaded: ${enabledCount} enabled, ${disabledCount} disabled`
      );
    } catch (error) {
      logService.error(`Failed to load extensions: ${error}`);
      // Ensure state is clean on error
      this.extensions = [];
      this.manifests.clear();
      this.extensionManifestMap.clear();
      this.allLoadedCommands = [];
    }
  }

  // --- Renamed: Only registers handlers ---
  private registerCommandHandlersFromManifests(): void {
    // Iterate over the collected commands from enabled extensions
    this.allLoadedCommands.forEach(({ cmd, manifest }) => {
      try {
        // Find the corresponding loaded extension instance
        const extension = this.extensions.find(
          (ext) => this.extensionManifestMap.get(ext)?.id === manifest.id
        );
        if (!extension) {
          logService.warn(
            `Extension instance not found for manifest ID ${manifest.id} when registering command handler ${cmd.id}. Skipping.`
          );
          return; // Skip if extension instance not found (shouldn't happen ideally)
        }

        const handler = {
          execute: async (args?: Record<string, any>) => {
            try {
              // Delegate execution to the extension instance
              return await extension.executeCommand(cmd.id, args);
            } catch (error) {
              logService.error(
                `Error executing command ${cmd.id} in extension ${manifest.id}: ${error}`
              );
              throw error; // Rethrow to allow commandService to handle/log
            }
          },
        };

        // Register handler with the command service
        commandService.registerCommand(
          `${manifest.id}.${cmd.id}`, // Unique command ID
          handler,
          manifest.id // Owning extension ID
        );

        // -------------------------------------------------------------------
        // Removed indexing logic from here
        // const commandData: Command = { ... };
        // indexExtensionCommand(commandData);
        // -------------------------------------------------------------------

        logService.debug(
          `Registered handler for command: ${cmd.id} for extension: ${manifest.id}`
        );
      } catch (error) {
        // Log error during handler registration for a specific command
        logService.error(
          `Error registering command handler for ${manifest.id}.${cmd.id}: ${error}`
        );
      }
    });
    logService.info(`Registered command handlers for enabled extensions.`);
  }
  // --- End registerCommandHandlersFromManifests ---

  private async loadExtensionWithManifest(
    path: string
  ): Promise<[Extension | null, ExtensionManifest | null]> {
    try {
      performanceService.startTiming(`load-extension:${path}`);
      // Using Promise.all to load module and manifest concurrently
      const [extensionModule, manifest] = await Promise.all([
        import(/* @vite-ignore */ path), // Dynamically import extension code
        import(/* @vite-ignore */ `${path}/manifest.json`), // Dynamically import manifest
      ]);

      const extension = extensionModule.default as Extension; // Expect default export for extension class/object
      if (!extension) {
        logService.error(
          `Invalid extension loaded from ${path}: missing default export`
        );
        performanceService.stopTiming(`load-extension:${path}`); // Ensure timing stops on error
        return [null, null];
      }
      // Basic validation (can be expanded)
      if (typeof extension.executeCommand !== "function") {
        logService.error(
          `Invalid extension loaded from ${path}: missing required executeCommand method`
        );
        performanceService.stopTiming(`load-extension:${path}`);
        return [null, null];
      }

      logService.info(
        `Loading extension manifest: ${manifest.id} (${manifest.name})`
      );
      const metrics = performanceService.stopTiming(`load-extension:${path}`);
      logService.debug(
        `Loaded extension module & manifest from ${path} in ${metrics.duration?.toFixed(
          2
        )}ms`
      );

      return [extension, manifest];
    } catch (error) {
      logService.error(
        `Failed to load extension or manifest from ${path}: ${error}`
      );
      performanceService.stopTiming(`load-extension:${path}`); // Ensure timing stops on error
      return [null, null];
    }
  }

  isExtensionEnabled(extensionName: string): boolean {
    return settingsService.isExtensionEnabled(extensionName);
  }

  async toggleExtensionState(
    extensionName: string,
    enabled: boolean
  ): Promise<boolean> {
    try {
      const success = await settingsService.updateExtensionState(
        extensionName,
        enabled
      );
      if (success) {
        logService.info(
          `Extension '${extensionName}' state set to ${
            enabled ? "enabled" : "disabled"
          }. Reloading extensions...`
        );
        // Reload extensions to reflect the change immediately
        await this.unloadExtensions(); // Unload first
        await this.loadExtensions(); // Reload enabled ones
        await this.syncCommandIndex(); // Re-sync index after reload
      }
      return success;
    } catch (error) {
      logService.error(
        `Failed to toggle extension state for '${extensionName}': ${error}`
      );
      return false;
    }
  }

  async getAllExtensionsWithState(): Promise<any[]> {
    try {
      const extensionIds = await discoverExtensions();
      const allExtensions: Array<any> = [];

      for (const id of extensionIds) {
        try {
          // Directly read manifest without importing the extension module
          const manifestPath = `../extensions/${id}/manifest.json`;
          const manifest = await import(/* @vite-ignore */ manifestPath);

          if (manifest) {
            allExtensions.push({
              title: manifest.name,
              subtitle: manifest.description,
              type: manifest.type,
              keywords: manifest.commands
                ?.map((cmd: any) => cmd.trigger || cmd.name)
                .join(" "),
              enabled: settingsService.isExtensionEnabled(manifest.name), // Check current setting
              id: id, // Use the directory name as ID
              version: manifest.version || "N/A", // Default version if missing
            });
          }
        } catch (error) {
          logService.warn(
            `Error loading manifest for potential extension ${id}: ${error}`
          );
          // Decide if partial info or skipping is better. Skipping for cleaner data.
        }
      }
      return allExtensions;
    } catch (error) {
      logService.error(`Error retrieving all extensions with state: ${error}`);
      return [];
    }
  }

  async handleViewSearch(query: string): Promise<void> {
    if (
      this.currentExtension &&
      typeof this.currentExtension.onViewSearch === "function"
    ) {
      try {
        await this.currentExtension.onViewSearch(query);
      } catch (error) {
        const extId = this.getExtensionId(this.currentExtension) || "unknown";
        logService.error(
          `Error during onViewSearch in extension ${extId}: ${error}`
        );
      }
    }
  }

  navigateToView(viewPath: string): void {
    const extensionId = viewPath.split("/")[0]; // Assuming viewPath is like "extensionId/viewName"
    // Find manifest by ID (more reliable than name if IDs are consistent)
    const manifest = Array.from(this.manifests.values()).find(
      (m) => m.id === extensionId
    );

    if (manifest) {
      logService.info(
        `EXTENSION_VIEW_OPENED: Extension view opened: ${viewPath} for extension: ${manifest.id}`
      );
      // ... (usage stats update) ...
      const now = Date.now();
      extensionUsageStats.update((stats) => {
        /* ... */ return stats;
      });
      extensionLastUsed.update((stats) => {
        /* ... */ return stats;
      });

      this.savedMainQuery = get(searchQuery);
      searchQuery.set(""); // Clear search for the view

      this.currentExtension =
        this.extensions.find(
          (ext) => this.extensionManifestMap.get(ext)?.id === manifest.id
        ) || null;

      activeViewSearchable.set(manifest.searchable ?? false);
      activeView.set(viewPath); // Trigger UI change

      if (
        this.currentExtension &&
        typeof this.currentExtension.viewActivated === "function"
      ) {
        try {
          this.currentExtension.viewActivated(viewPath);
        } catch (error) {
          logService.error(
            `Error during viewActivated for ${manifest.id}: ${error}`
          );
        }
      }
      logService.debug(
        `Mapsd to view: ${viewPath}, searchable: ${manifest.searchable}`
      );
    } else {
      logService.error(
        `Cannot navigate: No enabled extension found with ID: ${extensionId}`
      );
    }
  }

  closeView(): void {
    const currentViewPath = get(activeView); // Get view path before clearing
    if (
      this.currentExtension &&
      typeof this.currentExtension.viewDeactivated === "function"
    ) {
      try {
        this.currentExtension.viewDeactivated(currentViewPath); // Pass the view path being deactivated
      } catch (error) {
        const extId = this.getExtensionId(this.currentExtension) || "unknown";
        logService.error(`Error during viewDeactivated for ${extId}: ${error}`);
      }
    }
    this.currentExtension = null;
    activeViewSearchable.set(false);
    searchQuery.set(this.savedMainQuery); // Restore previous query
    activeView.set(null); // Clear the active view
    logService.debug(`Closed view, restored query: "${this.savedMainQuery}"`);
  }

  // Consider if this method is still needed or if search results should come purely from index
  async getAllExtensions(): Promise<any[]> {
    logService.warn(
      "getAllExtensions returning data based on loaded manifests, may not reflect searchable state accurately."
    );
    const allItems: any[] = [];
    this.manifests.forEach((manifest) => {
      // Iterate loaded manifests directly
      allItems.push({
        title: manifest.name,
        subtitle: manifest.description,
        keywords:
          manifest.commands?.map((cmd) => cmd.trigger || cmd.name).join(" ") ||
          "",
        type: manifest.type,
        action: () => {
          // Example action - adjust as needed
          if (manifest.type === "view" && manifest.defaultView) {
            this.navigateToView(`${manifest.id}/${manifest.defaultView}`);
          } else if (manifest.commands && manifest.commands.length > 0) {
            // Maybe execute first command? Or navigate to a general extension info view?
            logService.info(
              `Default action triggered for non-view extension: ${manifest.id}`
            );
          }
        },
        // Add other relevant fields if needed by UI
      });
    });
    return allItems;
  }

  async uninstallExtension(
    extensionId: string,
    extensionName: string
  ): Promise<boolean> {
    logService.info(
      `Attempting to uninstall extension ID: ${extensionId}, Name: ${extensionName}`
    );
    try {
      extensionUninstallInProgress.set(extensionId);

      // Use settingsService to check/update state by name
      if (settingsService.isExtensionEnabled(extensionName)) {
        logService.debug(
          `Disabling extension '${extensionName}' before uninstall.`
        );
        await settingsService.updateExtensionState(extensionName, false);
        // No immediate reload needed here, will happen after deletion
      }

      const extensionsDir = await this.getExtensionsDirectory();
      const extensionPath = await join(extensionsDir, extensionId); // Use ID for path

      // Safety check remains important
      if (!extensionPath.includes("extensions") || extensionId.includes("..")) {
        // Basic check
        throw new Error(
          `Safety check failed: Invalid path derived for ${extensionId}`
        );
      }

      // Check existence using FS plugin before attempting deletion
      const pathExists = await exists(extensionPath);
      if (!pathExists) {
        logService.warn(
          `Extension directory not found at ${extensionPath}. Skipping deletion.`
        );
        // Still remove settings and reload state
      } else {
        logService.debug(`Attempting to delete directory: ${extensionPath}`);
        // Using FS plugin directly for deletion - recursive is crucial
        await remove(extensionPath, { recursive: true });
        logService.info(`Successfully deleted directory: ${extensionPath}`);
      }

      // Remove from extension settings by name
      await settingsService.removeExtensionState(extensionName);
      logService.debug(`Removed settings for extension: ${extensionName}`);

      // Force a refresh of loaded extensions and re-sync the index
      logService.info(
        "Reloading extensions and re-syncing index after uninstall..."
      );
      await this.unloadExtensions(); // Ensure clean state
      await this.loadExtensions(); // Load remaining enabled extensions
      await this.syncCommandIndex(); // Sync index based on new state

      logService.info(
        `Extension ${extensionId} (${extensionName}) uninstalled successfully.`
      );
      return true;
    } catch (error) {
      logService.error(
        `Failed to uninstall extension ${extensionId} (${extensionName}): ${error}`
      );
      return false;
    } finally {
      extensionUninstallInProgress.set(null);
    }
  }

  private async getExtensionsDirectory(): Promise<string> {
    try {
      const isDev = import.meta.env?.DEV === true;
      let basePath: string;
      if (isDev) {
        // In dev, extensions are likely part of the source code structure
        // Adjust this path based on your actual dev setup relative to `src-tauri`
        // Assuming extensions are at the root level for simplicity here
        basePath = await resourceDir(); // Or use a fixed relative path if more reliable
        // This might need adjustment: `../extensions` relative to where JS code runs?
        logService.warn(
          "Using development path for extensions. Ensure '../extensions' is correct relative to runtime."
        );
        return await join(basePath, "..", "extensions"); // Example adjustment
      } else {
        // In production, use appDataDir
        basePath = await appDataDir();
        return await join(basePath, "extensions");
      }
    } catch (error) {
      logService.error(`Failed to get base directory: ${error}. Falling back.`);
      // Fallback logic might need refinement depending on packaging
      try {
        const resourceDirectory = await resourceDir();
        return await join(resourceDirectory, "_up_/", "extensions"); // Common pattern in Tauri packaged apps
      } catch (fallbackError) {
        logService.error(
          `Fallback to resource directory failed: ${fallbackError}. Cannot determine extensions directory.`
        );
        throw new Error("Could not determine extensions directory."); // Propagate error if no path found
      }
    }
  }

  /**
   * Get extension ID from extension instance
   */
  getExtensionId(extension: Extension): string | undefined {
    return this.extensionManifestMap.get(extension)?.id;
  }
}

export default new ExtensionManager();
