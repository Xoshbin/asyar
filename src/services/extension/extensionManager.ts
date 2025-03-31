import { writable, get } from "svelte/store";
import { searchQuery } from "../search/stores/search"; // Keep for viewManager interaction
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
import { discoverExtensions, isBuiltInExtension } from "./extensionDiscovery";
import { ExtensionBridge } from "asyar-api";
import { logService } from "../log/logService";
import { NotificationService } from "../notification/notificationService";
import { ClipboardHistoryService } from "../clipboard/clipboardHistoryService";
import { actionService } from "../action/actionService";
import { commandService } from "./commandService";
import { performanceService } from "../performance/performanceService";
import { viewManager, activeView, activeViewSearchable } from './viewManager'; // Import the new view manager and its stores

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
class ExtensionManager implements IExtensionManager {
  private bridge = ExtensionBridge.getInstance();
  private extensions: Extension[] = [];
  private manifestsById: Map<string, ExtensionManifest> = new Map(); // Changed name for clarity
  private extensionManifestMap: Map<Extension, ExtensionManifest> = new Map();
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
      const extensionId = currentView.split('/')[0];
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
      await this.loadExtensions(); // This populates manifestsById and extensionsById
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
        const objectId = this.getCmdObjectId(
          commandInfo.cmd,
          commandInfo.manifest
        );
        currentCommandMap.set(objectId, commandInfo);
      });
      const currentCommandIds = new Set(currentCommandMap.keys());

      const indexedCommandIds = await searchService.getIndexedObjectIds("cmd_");

      const itemsToIndex: SearchableItem[] = [];
      const idsToDelete: string[] = [];

      currentCommandMap.forEach(({ cmd, manifest }, objectId) => {
        itemsToIndex.push({
          category: "command",
          id: objectId,
          name: cmd.name,
          extension: manifest.id,
          trigger: cmd.trigger || cmd.name,
          type: cmd.resultType || manifest.type,
        });
      });

      indexedCommandIds.forEach((indexedId) => {
        if (!currentCommandIds.has(indexedId)) {
          idsToDelete.push(indexedId);
        }
      });

      logService.info(
        `Command Sync: ${itemsToIndex.length} items to index, ${idsToDelete.length} items to delete.`
      );

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
      throw error;
    }
  }

  async unloadExtensions(): Promise<void> {
    // Clear commands first
    this.manifestsById.forEach(manifest => {
        commandService.clearCommandsForExtension(manifest.id);
    });

    // Deactivate extensions via bridge
    await this.bridge.deactivateExtensions();

    // Clear internal state
    this.extensionsById.clear();
    this.manifestsById.clear();
    this.extensionManifestMap.clear();
    this.allLoadedCommands = [];
    this.initialized = false; // Mark as uninitialized

    // Reset view manager state if needed (closeView handles most of it)
    if (viewManager.isViewActive()) {
        viewManager.closeView(); // Ensure view is closed if an extension was active
    }

    logService.info("Extensions unloaded and state cleared.");
  }

  async loadExtensions() {
    try {
      performanceService.startTiming("extension-discovery");
      const extensionIds = await discoverExtensions();
      logService.debug(
        `Discovery returned ${extensionIds.length} extension IDs`
      );

      // Clear previous state before loading
      this.extensionsById.clear();
      this.manifestsById.clear();
      this.extensionManifestMap.clear();
      this.allLoadedCommands = [];

      const extensionPairs = await Promise.all(
        extensionIds.map(async (id) => { // id here is the directory name/extension id
          const path = isBuiltInExtension(id)
            ? `../../built-in-extensions/${id}`
            : `../../extensions/${id}`;
          return this.loadExtensionWithManifest(path);
        })
      );

      let enabledCount = 0;
      let disabledCount = 0;
      for (const [extension, manifest] of extensionPairs) {
        if (extension && manifest && manifest.id) { // Ensure manifest has an ID
          const isBuiltIn = isBuiltInExtension(manifest.id); // Use helper function
          const isEnabled =
            isBuiltIn || settingsService.isExtensionEnabled(manifest.id);

          if (isEnabled) {
            performanceService.trackExtensionLoadStart(manifest.id);
            // Store by ID
            this.extensionsById.set(manifest.id, extension);
            this.manifestsById.set(manifest.id, manifest);
            this.extensionManifestMap.set(extension, manifest); // Keep this map if needed for direct extension->manifest lookup

            // Register with bridge
            this.bridge.registerManifest(manifest);
            this.bridge.registerExtensionImplementation(manifest.id, extension);

            // Collect commands
            if (manifest.commands) {
              manifest.commands.forEach((cmd) => {
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

      this.registerCommandHandlersFromManifests();

      logService.debug(
        `Extensions loaded: ${enabledCount} enabled, ${disabledCount} disabled`
      );
     } catch (error) {
       logService.error(`Failed to load extensions: ${error}`);
       // Clear potentially partially populated maps on error
       this.extensionsById.clear();
       this.manifestsById.clear(); // Corrected reference
       this.extensionManifestMap.clear();
       this.allLoadedCommands = [];
    }
  }

  private registerCommandHandlersFromManifests(): void {
    logService.debug(`Registering command handlers for ${this.allLoadedCommands.length} loaded commands.`);
    this.allLoadedCommands.forEach(({ cmd, manifest }) => {
      try {
        // Find the extension instance using the manifest ID
        const extension = this.extensionsById.get(manifest.id);
        if (!extension) {
           logService.warn(`Could not find loaded extension instance for ID: ${manifest.id} while registering command: ${cmd.id}`);
           return; // Skip if extension instance not found
        }

        const fullObjectId = this.getCmdObjectId(cmd, manifest);
        const shortCmdId = cmd.id;

        const handler = {
          execute: async (args?: Record<string, any>) => {
            return await extension.executeCommand(shortCmdId, args);
          },
        };
        commandService.registerCommand(fullObjectId, handler, manifest.id);

        logService.debug(
          `Registered handler for command: ${shortCmdId} (ID: ${fullObjectId}) for extension: ${manifest.id}`
        );
      } catch (error) {
         logService.error(`Error registering handler for command ${cmd.id} of extension ${manifest.id}: ${error}`);
      }
    });
    logService.info(`Finished registering command handlers for enabled extensions.`);
  }

  private async loadExtensionWithManifest(
    path: string
  ): Promise<[Extension | null, ExtensionManifest | null]> {
    try {
      performanceService.startTiming(`load-extension:${path}`);
      const [extensionModule, manifest] = await Promise.all([
        import(/* @vite-ignore */ path),
        import(/* @vite-ignore */ `${path}/manifest.json`),
      ]);

      const extension = extensionModule.default as Extension;
      if (!extension) {
        logService.error(
          `Invalid extension loaded from ${path}: missing default export`
        );
        performanceService.stopTiming(`load-extension:${path}`);
        return [null, null];
      }
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
      performanceService.stopTiming(`load-extension:${path}`);
      return [null, null];
    }
  }

  // --- Methods delegated to ViewManager ---

  navigateToView(viewPath: string): void {
      // Update usage stats before navigating
      const extensionId = viewPath.split("/")[0];
      const manifest = this.manifestsById.get(extensionId);
      if (manifest) {
          logService.info(`Extension view opened: ${viewPath} for extension: ${manifest.id}`);
          const now = Date.now();
          extensionUsageStats.update(stats => ({ ...stats, [manifest.id]: (stats[manifest.id] || 0) + 1 }));
          extensionLastUsed.update(stats => ({ ...stats, [manifest.id]: now }));
      }
      // Delegate to viewManager
      viewManager.navigateToView(viewPath);
  }

  closeView(): void {
      viewManager.closeView();
  }

  handleViewSearch(query: string): Promise<void> {
      // This is now primarily handled by viewManager calling the registered handler
      return viewManager.handleViewSearch(query);
  }

  // --- Internal handlers passed to ViewManager ---

  private async handleExtensionSearch(query: string): Promise<void> {
      const currentView = viewManager.getActiveView();
      if (!currentView) return;

      const extensionId = currentView.split('/')[0];
      const extension = this.extensionsById.get(extensionId);

      if (extension && typeof extension.onViewSearch === 'function') {
          try {
              await extension.onViewSearch(query);
          } catch (error) {
              logService.error(`Error during onViewSearch in extension ${extensionId}: ${error}`);
          }
      } else {
          logService.warn(`onViewSearch not implemented or extension not found for ID: ${extensionId}`);
      }
  }

  private handleExtensionViewActivated(extensionId: string, viewPath: string): void {
      const extension = this.extensionsById.get(extensionId);
      if (extension && typeof extension.viewActivated === 'function') {
          try {
              extension.viewActivated(viewPath);
          } catch (error) {
              logService.error(`Error during viewActivated for ${extensionId}: ${error}`);
          }
      }
  }

  private handleExtensionViewDeactivated(extensionId: string | null, viewPath: string | null): void {
      if (!extensionId || !viewPath) return; // Nothing to deactivate if no extension was active

      const extension = this.extensionsById.get(extensionId);
      if (extension && typeof extension.viewDeactivated === 'function') {
          try {
              extension.viewDeactivated(viewPath);
          } catch (error) {
              logService.error(`Error during viewDeactivated for ${extensionId}: ${error}`);
          }
      }
  }


  // --- Existing Methods (potentially adapted) ---

  isExtensionEnabled(extensionId: string): boolean { // Parameter changed to ID
    return settingsService.isExtensionEnabled(extensionId);
  }

  async toggleExtensionState(
    extensionId: string, // Parameter changed to ID
    enabled: boolean
  ): Promise<boolean> {
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

  async getAllExtensionsWithState(): Promise<any[]> { // Keep returning manifest-like structure for settings UI
    try {
      const discoveredIds = await discoverExtensions();
      const allExtensionsData: Array<any> = [];

      for (const id of discoveredIds) {
        try {
          // Determine path based on built-in or regular
           const isBuiltIn = isBuiltInExtension(id);
           const basePath = isBuiltIn ? `../../built-in-extensions/${id}` : `../../extensions/${id}`;
           const manifestPath = `${basePath}/manifest.json`;
           const manifestModule = await import(/* @vite-ignore */ manifestPath);
           const manifest = manifestModule.default || manifestModule; // Handle potential default export

          if (manifest && manifest.id && manifest.name) { // Ensure manifest has basic required fields
            allExtensionsData.push({
              title: manifest.name,
              subtitle: manifest.description || '',
              type: manifest.type || 'unknown',
              keywords: manifest.commands
                ?.map((cmd: any) => cmd.trigger || cmd.name)
                .join(" ") || "",
              enabled: isBuiltIn || settingsService.isExtensionEnabled(manifest.id), // Use ID for check
              id: manifest.id, // Use ID from manifest
              version: manifest.version || "N/A",
              isBuiltIn: isBuiltIn, // Add flag for UI differentiation
            });
          } else {
             logService.warn(`Skipping potential extension ${id}: Invalid or incomplete manifest at ${manifestPath}`);
          }
        } catch (error) {
          // Don't log full error for non-existent manifests, just debug log
          if (error instanceof Error && error.message.includes('Failed to fetch dynamically imported module')) {
             logService.debug(`Manifest not found for potential extension ${id}, likely not an extension directory.`);
          } else {
             logService.warn(`Error loading manifest for potential extension ${id}: ${error}`);
          }
        }
      }
      return allExtensionsData;
    } catch (error) {
      logService.error(`Error retrieving all extensions with state: ${error}`);
      return [];
    }
  }


  async getAllExtensions(): Promise<any[]> { // This seems deprecated or for a specific UI use case?
     logService.warn(
       "getAllExtensions is potentially deprecated or UI-specific. Returning data based on currently loaded *enabled* manifests."
     );
     const allItems: any[] = [];
     this.manifestsById.forEach((manifest) => { // Iterate loaded manifests
       // Check if it's actually enabled (should be, as we only load enabled ones, but double-check)
       const isBuiltIn = isBuiltInExtension(manifest.id); // Use helper function
       if (isBuiltIn || this.isExtensionEnabled(manifest.id)) {
           allItems.push({
             title: manifest.name, // Assuming name exists based on previous checks
             subtitle: manifest.description,
             keywords:
               manifest.commands?.map((cmd) => cmd.trigger || cmd.name).join(" ") ||
               "",
             type: manifest.type,
             action: () => { // Action now uses navigateToView
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
    logService.info(
      `Attempting to uninstall extension ID: ${extensionId}`
    );
    // Find manifest name for settings removal (if needed, though ID is preferred)
    const manifest = this.manifestsById.get(extensionId) || (await this.tryLoadManifestForUninstall(extensionId));
    const extensionName = manifest?.name; // May be undefined if manifest load failed

    try {
      extensionUninstallInProgress.set(extensionId);

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
      if (isBuiltInExtension(extensionId)) {
         throw new Error(`Safety check failed: Cannot uninstall built-in extension ${extensionId}`);
      }
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
        `Extension ${extensionId} ${extensionName ? `(${extensionName})` : ''} uninstalled successfully.`
      );
      return true;
    } catch (error) {
      logService.error(
        `Failed to uninstall extension ${extensionId} ${extensionName ? `(${extensionName})` : ''}: ${error}`
      );
      return false;
    } finally {
      extensionUninstallInProgress.set(null);
    }
  }

  // Helper to try loading manifest just for getting name during uninstall if not already loaded
  private async tryLoadManifestForUninstall(extensionId: string): Promise<ExtensionManifest | null> {
     try {
        const isBuiltIn = isBuiltInExtension(extensionId);
        if (isBuiltIn) return null; // Should not happen due to earlier check, but safe guard
        const basePath = `../../extensions/${extensionId}`;
        const manifestPath = `${basePath}/manifest.json`;
        const manifestModule = await import(/* @vite-ignore */ manifestPath);
        return manifestModule.default || manifestModule;
     } catch {
        logService.warn(`Could not load manifest for extension ${extensionId} during uninstall to get name.`);
        return null;
     }
  }


  private async getExtensionsDirectory(): Promise<string> {
    try {
      const isDev = import.meta.env?.DEV === true; // Check for development mode
      let basePath: string;
      if (isDev) {
        basePath = await resourceDir();
        logService.warn(
          "Using development path for extensions. Ensure '../../extensions' is correct relative to runtime."
        );
        return await join(basePath, "..", "extensions");
      } else {
        basePath = await appDataDir();
        return await join(basePath, "extensions");
      }
    } catch (error) {
      logService.error(`Failed to get base directory: ${error}. Falling back.`);
      try {
        const resourceDirectory = await resourceDir();
        return await join(resourceDirectory, "_up_/", "extensions");
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
