import { writable, get, type Writable } from "svelte/store";
import { searchQuery } from "../search/stores/search";
import { settingsService } from "../settings/settingsService";
import { exists, remove } from "@tauri-apps/plugin-fs"; // Remove createDir, writeBinaryFile
import { join, resourceDir, appDataDir } from "@tauri-apps/api/path"; // Keep path import
import * as commands from "../../lib/ipc/commands";
import type {
  Extension,
  ExtensionManifest,
  ExtensionResult,
  IExtensionManager,
  ExtensionCommand,
} from "asyar-sdk";

// Local extension of the manifest type to include properties not yet in the SDK
interface ExtendedManifest extends ExtensionManifest {
  permissions?: string[];
  main?: string;
}
import { discoverExtensions, isBuiltInExtension } from "./extensionDiscovery"; // Re-added discoverExtensions
import { ExtensionBridge } from "asyar-sdk";
import { logService } from "../log/logService";
import { extensionLoaderService } from "../extensionLoaderService"; // Import the new loader service (correct path)
import { NotificationService } from "../notification/notificationService";
import { ClipboardHistoryService } from "../clipboard/clipboardHistoryService";
import { actionService } from "../action/actionService";
import { statusBarService } from "../statusBar/statusBarService";
import { commandService } from "./commandService";
import { performanceService } from "../performance/performanceService";
import { viewManager, activeView, activeViewSearchable, activeViewPrimaryActionLabel, activeViewStatusMessage } from "./viewManager";
import { envService } from "../envService";
import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';

import type { SearchableItem } from "../search/types/SearchableItem";
import { searchService } from "../search/SearchService";
import { invalidateTopItemsCache } from "../search/topItemsCache";
import { checkPermission } from "../permissionGate";
import { ExtensionIpcRouter } from "./ExtensionIpcRouter";
import { ExtensionLoader } from "./ExtensionLoader";

/**
 * Shape of a loaded extension module. Can be either a direct Extension instance
 * or an ES module wrapper where the extension is the default export.
 */
type LoadedExtensionModule = Extension | { default: Extension };


import { extensionSearchAggregator } from "./extensionSearchAggregator";
import { 
  extensionStateManager, 
  extensionUsageStats, 
  extensionLastUsed, 
  extensionUninstallInProgress 
} from "./extensionStateManager";
import { extensionIframeManager } from "./extensionIframeManager";

/**
 * Manages application extensions
 */
// Explicitly export the class for type imports
export class ExtensionManager implements IExtensionManager {
  private bridge = ExtensionBridge.getInstance();
  private manifestsById: Map<string, ExtendedManifest> = new Map();
  private extensionModulesById: Map<string, LoadedExtensionModule> = new Map();
  private initialized = false;
  private allLoadedCommands: {
    cmd: ExtensionCommand;
    manifest: ExtensionManifest;
    isBuiltIn: boolean;
  }[] = [];
  private mountedComponents = new Map<string, any>(); // mountId -> component instance
  public isReady: Writable<boolean> = writable(false); // Add this store
  private readonly serviceRegistry: Record<string, any>;
  private loader: ExtensionLoader;

  // Getter to satisfy IExtensionManager interface based on viewManager state
  get currentExtension(): Extension | null {
    const currentView = viewManager.getActiveView();
    if (!currentView) return null;
    const extensionId = currentView.split("/")[0];
    const module = this.extensionModulesById.get(extensionId);
    if (!module) return null;
    // Return the default export (the class instance) or the module itself if no default
    return this.resolveExtensionInstance(module);
  }

  /**
   * Resolve an extension instance from a loaded module. Handles both direct
   * Extension instances and ES modules where the extension is the default export.
   */
  private resolveExtensionInstance(module: LoadedExtensionModule): Extension {
    return extensionSearchAggregator.resolveExtensionInstance(module);
  }

  // Public getter for the full module, needed by +page.svelte
  public getLoadedExtensionModule(id: string): LoadedExtensionModule | undefined {
    return this.extensionModulesById.get(id);
  }









  constructor() {
    // Build the IPC service registry once. Used by setupIpcHandler to dispatch
    // asyar:api:* / asyar:service:* messages without allocating on every call.
    this.serviceRegistry = {
      'LogService': logService,
      'ExtensionManager': this,
      'NotificationService': new NotificationService(),
      'ClipboardHistoryService': ClipboardHistoryService.getInstance(),
      'CommandService': commandService,
      'ActionService': actionService,
      'SettingsService': {
        get: async (section: string, key: string) => {
          const settings = settingsService.getSettings();
          return (settings as any)[section]?.[key];
        },
        set: async (section: string, key: string, value: any) => {
          return settingsService.updateSettings(section as any, { [key]: value });
        }
      },
      'StatusBarService': statusBarService,
    };

    extensionIframeManager.init(viewManager);
    actionService.setExtensionForwarder(extensionIframeManager.sendActionExecuteToExtension.bind(extensionIframeManager));
    
    // Subscribe to settings changes and broadcast to extensions
    settingsService.subscribe((settings) => {
      // Broadcast calculator settings change
      window.postMessage({
        type: 'asyar:event:settingsChanged',
        section: 'calculator',
        payload: settings.calculator
      }, window.location.origin);

      // Also broadcast to iframes
      extensionIframeManager.broadcastSettingsToIframes(settings);
    });

    this.loader = new ExtensionLoader(
      this.bridge,
      (id, manifest) => { this.manifestsById.set(id, manifest); },
      (id, module) => { this.extensionModulesById.set(id, module); },
      (cmd, manifest, isBuiltIn) => { this.allLoadedCommands.push({ cmd, manifest, isBuiltIn }); },
    );

    const ipcRouter = new ExtensionIpcRouter(
      this.serviceRegistry,
      this.getManifestById.bind(this),
      this.goBack.bind(this),
      () => searchService.saveIndex()
    );
    ipcRouter.setup();
  }

  async init(): Promise<boolean> {
    if (this.initialized) {
      logService.debug("ExtensionManager already initialized.");
      return true;
    }
    logService.custom("🔄 Initializing extension manager...", "EXTN", "blue");
    try {
      await performanceService.init();

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

      // Initialize services after extensions are loaded
      extensionSearchAggregator.init(this.extensionModulesById, this.isExtensionEnabled.bind(this));
      extensionStateManager.init(this.manifestsById, this.reloadExtensionsFilesAndSync.bind(this));

      // Initialize ViewManager *after* manifests are loaded
      viewManager.init(
        this.manifestsById,
        this.handleExtensionSearch.bind(this),
        this.handleExtensionSubmit.bind(this), 
        this.handleExtensionViewActivated.bind(this),
        this.handleExtensionViewDeactivated.bind(this)
      );

      performanceService.startTiming("command-index-sync");
      await this.syncCommandIndex(); 
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

  public async handleCommandAction(commandObjectId: string, args?: Record<string, any>): Promise<void> {
    logService.debug(`Handling command action for: ${commandObjectId}`);
    try {
      // Handle browser fallback IDs for seamless navigation
      if (commandObjectId === 'ext_store') {
        this.navigateToView('store/DefaultView');
        return;
      }
      if (commandObjectId === 'ext_clipboard') {
        this.navigateToView('clipboard-history/DefaultView');
        return;
      }

      const result = await commandService.executeCommand(commandObjectId, args);
      if (result?.type === 'no-view') {
        searchService.saveIndex();
        commands.hideWindow();
      }
      // --- Add usage recording ---
      if (envService.isTauri) {
        logService.debug(`Recording usage for command: ${commandObjectId}`);
        commands.recordItemUsage(commandObjectId)
          .then(() => {
            logService.debug(`Usage recorded for ${commandObjectId}`);
            invalidateTopItemsCache();
          })
          .catch((err) =>
            logService.error(
              `Failed to record usage for ${commandObjectId}: ${err}`
            )
          );
      }
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
    await this.loader.syncCommandIndex(this.allLoadedCommands);
  }

  // Helper for toggleExtensionState to avoid circular dependency or method binding issues
  private async reloadExtensionsFilesAndSync(): Promise<void> {
    await this.unloadExtensions();
    await this.loadExtensions();
    await this.syncCommandIndex();
  }

  async reloadExtensions(): Promise<void> {
    logService.info("Explicitly reloading extensions...");
    try {
      // Clear existing commands first
      this.manifestsById.forEach((manifest) => {
        if (manifest && manifest.id) {
          commandService.clearCommandsForExtension(manifest.id);
        }
      });

      performanceService.startTiming("extension-reloading");
      await this.loadExtensions();
      
      performanceService.startTiming("command-index-sync");
      await this.syncCommandIndex();
      const syncMetrics = performanceService.stopTiming("command-index-sync");
      const loadMetrics = performanceService.stopTiming("extension-reloading");
      logService.custom(
        `🔄 Extensions reloaded and synced in ${loadMetrics.duration?.toFixed(2)}ms`,
        "PERF",
        "green"
      );
    } catch (e) {
      logService.error(`Failed to reload extensions: ${e}`);
      throw e;
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
    this.extensionModulesById.clear(); // Clear modules map
    this.manifestsById.clear();
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
    // Clear previous state before loading
    this.extensionModulesById.clear();
    this.manifestsById.clear();
    this.allLoadedCommands = [];
    await this.loader.loadExtensions(
      this.navigateToView.bind(this),
      this.isReady,
    );
  }



  public getManifestById(id: string): ExtendedManifest | undefined {
    return this.manifestsById.get(id);
  }

  public setActiveViewActionLabel(label: string | null): void {
    logService.info(`[ExtensionManager] Setting active view action label to: ${label}`);
    activeViewPrimaryActionLabel.set(label);
  }

  public setActiveViewStatusMessage(message: string | null): void {
    logService.info(`[ExtensionManager] Setting active view status message to: ${message}`);
    activeViewStatusMessage.set(message);
  }

  forwardKeyToActiveView(keyEvent: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): void {
    extensionIframeManager.forwardKeyToActiveView(keyEvent);
  }

  sendActionExecuteToExtension(extensionId: string, actionId: string): void {
    extensionIframeManager.sendActionExecuteToExtension(extensionId, actionId);
  }

  // --- Methods delegated to ViewManager ---

  navigateToView(viewPath: string): void {
    logService.info(`[ExtensionManager] Navigating to view: ${viewPath}`);
    const extensionId = viewPath.split("/")[0];
    
    // Delegate usage tracking to state manager
    extensionStateManager.recordViewUsage(extensionId);
    
    // Delegate to viewManager
    viewManager.navigateToView(viewPath);
  }

  // Renamed from closeView to match interface
  public goBack(): void {
    viewManager.goBack(); // Delegate to viewManager
  }

  public handleViewSearch(query: string): Promise<void> {
    // This is now primarily handled by viewManager calling the registered handler
    return viewManager.handleViewSearch(query);
  }

  handleViewSubmit(query: string): Promise<void> {
    return viewManager.handleViewSubmit(query);
  }

  // --- Internal handlers passed to ViewManager ---

  private async handleExtensionSearch(query: string): Promise<void> {
    const currentView = viewManager.getActiveView();
    if (!currentView) return;

    const extensionId = currentView.split("/")[0];
    const module = this.extensionModulesById.get(extensionId);
    if (!module) return;
    const extensionInstance = this.resolveExtensionInstance(module); // Get the instance

    if (extensionInstance && typeof extensionInstance.onViewSearch === "function") {
      try {
        // Call onViewSearch on the instance
        await extensionInstance.onViewSearch(query);
      } catch (error) {
        logService.error(`[ExtensionManager] Error calling onViewSearch for ${extensionId}: ${error}`);
      }
    }
  }

  private async handleExtensionSubmit(query: string): Promise<void> {
    const currentView = viewManager.getActiveView();
    if (!currentView) return;

    const extensionId = currentView.split("/")[0];
    const module = this.extensionModulesById.get(extensionId);
    if (!module) return;
    const extensionInstance = this.resolveExtensionInstance(module);

    if (extensionInstance && typeof extensionInstance.onViewSubmit === "function") {
      try {
        await extensionInstance.onViewSubmit(query);
      } catch (error) {
        logService.error(`[ExtensionManager] Error calling onViewSubmit for ${extensionId}: ${error}`);
      }
    } else {
      // For Tier 2 (iframes)
      extensionIframeManager.handleExtensionSubmit(extensionId, query);
    }
  }

  private handleExtensionViewActivated(
    extensionId: string,
    viewPath: string
  ): void {
    const module = this.extensionModulesById.get(extensionId);
    if (!module) return;
    const extension = this.resolveExtensionInstance(module);
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

    const module = this.extensionModulesById.get(extensionId);
    if (!module) return;
    const extension = this.resolveExtensionInstance(module);
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
    return extensionStateManager.isExtensionEnabled(extensionId);
  }

  async toggleExtensionState(
    extensionId: string,
    enabled: boolean
  ): Promise<boolean> {
    return extensionStateManager.toggleExtensionState(extensionId, enabled);
  }

  async getAllExtensionsWithState(): Promise<any[]> {
    return extensionStateManager.getAllExtensionsWithState();
  }

  async getAllExtensions(): Promise<any[]> {
    return extensionStateManager.getAllExtensions(this.navigateToView.bind(this));
  }

  async uninstallExtension(
    extensionId: string,
    extensionName?: string // Optional for backward compatibility but required by interface
  ): Promise<boolean> {
    logService.info(`Attempting to uninstall extension ID: ${extensionId}`);
    // Find manifest name for settings removal (if needed, though ID is preferred)
    // Try loading manifest specifically for uninstall info if not already loaded
    const manifest =
      this.manifestsById.get(extensionId) ||
      (await this.tryLoadManifestForUninstall(extensionId));
    const manifestName = manifest?.name; // May be undefined if manifest load failed

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
      
      // Cleanup tray menu items
      statusBarService.clearItemsForExtension(extensionId);

      // Reloading sequence remains the same
      logService.info(
        "Reloading extensions and re-syncing index after uninstall..."
      );
      await this.unloadExtensions();
      await this.loadExtensions();
      await this.syncCommandIndex();

      logService.info(
        `Extension ${extensionId} ${
          extensionName || manifestName ? `(${extensionName || manifestName})` : ""
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
  async searchAll(query: string): Promise<ExtensionResult[]> {
    return extensionSearchAggregator.searchAll(query);
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
    // Determine mode first
    const isDev = import.meta.env.MODE === "development";

    if (isDev) {
      logService.debug(
        "Determining extensions directory for development mode..."
      );
      try {
        const resDir = await resourceDir();
        // Use non-null assertion as workaround
        const projectRoot = await join!(resDir, "..", "..", "..");
        const devExtensionsPath = await join!(projectRoot, "extensions");
        logService.warn(
          `Using development path for extensions: ${devExtensionsPath}`
        );
        return devExtensionsPath;
      } catch (devError) {
        logService.error(
          `Failed to determine dev extensions directory: ${devError}. Trying fallback...`
        );
        // Fallback for dev (less likely needed, but for safety)
        try {
          const resourceDirectory = await resourceDir();
          // Use non-null assertion as workaround
          return await join!(resourceDirectory, "_up_/", "extensions");
        } catch (fallbackError) {
          logService.error(
            `Dev fallback failed: ${fallbackError}. Cannot determine extensions directory.`
          );
          throw new Error("Could not determine dev extensions directory.");
        }
      }
    } else {
      logService.debug(
        "Determining extensions directory for production mode..."
      );
      try {
        const appDataDirPath = await appDataDir();
        // Use non-null assertion as workaround
        const prodExtensionsPath = await join!(appDataDirPath, "extensions");
        logService.info(
          `Using production path for extensions: ${prodExtensionsPath}`
        );
        return prodExtensionsPath;
      } catch (prodError) {
        logService.error(
          `Failed to determine prod extensions directory using appDataDir: ${prodError}. Trying fallback...`
        );
        // Fallback for production (using resourceDir relative path)
        try {
          const resourceDirectory = await resourceDir();
          // Use non-null assertion as workaround
          const fallbackPath = await join!(
            resourceDirectory,
            "_up_/",
            "extensions"
          );
          logService.warn(
            `Using production fallback path for extensions: ${fallbackPath}`
          );
          return fallbackPath;
        } catch (fallbackError) {
          logService.error(
            `Prod fallback failed: ${fallbackError}. Cannot determine extensions directory.`
          );
          throw new Error("Could not determine prod extensions directory.");
        }
      }
    }
  }

  // Use extensionsById map instead if needed: this.extensionsById.get(id) -> Extension

  /**
   * Installs an extension from a given URL
   * This function delegates to the Tauri command which handles downloading and extracting
   */
  // --- Replacement for installExtensionFromUrl ---
}

const extensionManagerInstance = new ExtensionManager();
const isReady = extensionManagerInstance.isReady; // Export the store itself
export { extensionManagerInstance as default, isReady };

// Re-export view stores for backward compatibility or direct use
export { activeView, activeViewSearchable };
