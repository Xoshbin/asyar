import { searchStores } from "../search/stores/search.svelte";
import { settingsService } from "../settings/settingsService.svelte";
import { resourceDir, appDataDir } from "@tauri-apps/api/path"; // Removed join, exists, remove
import * as commands from "../../lib/ipc/commands";
import { uninstallExtension } from "../../lib/ipc/commands";
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
import { discoverExtensions, isBuiltInFeature } from "./extensionDiscovery"; // Re-added discoverExtensions
import { ExtensionBridge } from "asyar-sdk";
import { logService } from "../log/logService";
import { contextModeService } from "../context/contextModeService.svelte";
import { extensionLoaderService } from "../extensionLoaderService"; // Import the new loader service (correct path)
import { NotificationService } from "../notification/notificationService";
import { ClipboardHistoryService } from "../clipboard/clipboardHistoryService";
import { actionService } from "../action/actionService.svelte";
import { statusBarService } from "../statusBar/statusBarService.svelte";
import { entitlementService } from '../auth/entitlementService.svelte';
import { feedbackService } from "../feedback/feedbackService.svelte";

import { commandService } from "./commandService.svelte";
import { performanceService } from "../performance/performanceService.svelte";
import { viewManager } from "./viewManager.svelte";
import { envService } from "../envService";
import { selectionService } from "../selection/selectionService";
import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';
import type { ExtensionRecord } from "../../types/ExtensionRecord";

import { searchService } from "../search/SearchService";
import { invalidateTopItemsCache } from "../search/topItemsCache";
import { applyTheme, removeTheme } from '../theme/themeService';
import { ExtensionIpcRouter } from "./ExtensionIpcRouter";
import { extensionStorageService } from "../storage/extensionStorageService";
import { ExtensionLoader } from "./ExtensionLoader";

/**
 * Shape of a loaded extension module. Can be either a direct Extension instance
 * or an ES module wrapper where the extension is the default export.
 */
type LoadedExtensionModule = Extension | { default: Extension };


import { extensionSearchAggregator } from "./extensionSearchAggregator";
import { 
  extensionStateManager 
} from "./extensionStateManager.svelte";
import { extensionIframeManager } from "./extensionIframeManager.svelte";

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
  
  // Svelte 5 reactive state
  public isReady = $state(false);
  private _extensionRecords = $state<ExtensionRecord[]>([]);
  
  public get extensionRecords() {
    return this._extensionRecords;
  }

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
      'EntitlementService': {
        check: (entitlement: string) => entitlementService.check(entitlement),
        getAll: () => entitlementService.getAll(),
      },
      'StorageService': extensionStorageService,
      'FeedbackService': feedbackService,
      'SelectionService': selectionService,
    };


    extensionIframeManager.init(viewManager);
    actionService.setExtensionForwarder(extensionIframeManager.sendActionExecuteToExtension.bind(extensionIframeManager));
    
    // Subscribe to settings changes and broadcast to extensions
    // IMPORTANT: The subscribe callback runs inside $effect.root → $effect.
    // `settings` is a $state Proxy — passing it directly to postMessage/IPC
    // causes DataCloneError because structuredClone cannot handle Svelte 5 Proxies.
    // Always use $state.snapshot() to strip the Proxy before any IPC boundary.
    settingsService.subscribe((settings) => {
      const plainSettings = $state.snapshot(settings);
      // Broadcast calculator settings change
      window.postMessage({
        type: 'asyar:event:settingsChanged',
        section: 'calculator',
        payload: plainSettings.calculator
      }, window.location.origin);

      // Also broadcast to iframes
      extensionIframeManager.broadcastSettingsToIframes(plainSettings);
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

      // Apply persisted custom theme if one is set
      const activeTheme = settingsService.getSettings().appearance?.activeTheme;
      if (activeTheme) {
        applyTheme(activeTheme).catch((err) => {
          console.error('Failed to apply persisted theme on startup:', err);
        });
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
      extensionSearchAggregator.init(
        this.extensionModulesById,
        this.manifestsById,
        this.isExtensionEnabled.bind(this),
        this.navigateToView.bind(this)
      );
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

      this.updateExtensionRecords();
      this.initialized = true;
      return true;
    } catch (error) {
      logService.error(`Failed to initialize extension manager: ${error}`);
      return false;
    }
  }

  public async handleCommandAction(commandObjectId: string, args?: Record<string, any>): Promise<any> {
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
      return result;
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

  async loadExtensions() {
    // Clear previous state before loading
    this.extensionModulesById.clear();
    this.manifestsById.clear();
    this.allLoadedCommands = [];
    
    // We pass this.isReady as a boolean now, let's see if loadExtensions expects a writable
    // If it does, we might need a wrapper.
    const isReadyWrapper = {
        set: (v: boolean) => { this.isReady = v; },
        subscribe: (fn: (v: boolean) => void) => { fn(this.isReady); return () => {}; }
    };
    
    await this.loader.loadExtensions(
      this.navigateToView.bind(this),
      isReadyWrapper as any,
    );
    this.updateExtensionRecords();
  }



  public getManifestById(id: string): ExtendedManifest | undefined {
    return this.manifestsById.get(id);
  }

  public setActiveViewActionLabel(label: string | null): void {
    logService.info(`[ExtensionManager] Setting active view action label to: ${label}`);
    viewManager.activeViewPrimaryActionLabel = label;
  }

  public setActiveViewSubtitle(subtitle: string | null): void {
    logService.info(`[ExtensionManager] Setting active view subtitle to: ${subtitle}`);
    viewManager.activeViewSubtitle = subtitle;
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

    if (module) {
      // Tier 1: Direct call to onViewSearch
      const extensionInstance = this.resolveExtensionInstance(module);
      if (extensionInstance && typeof extensionInstance.onViewSearch === "function") {
        try {
          await extensionInstance.onViewSearch(query);
        } catch (error) {
          logService.error(`[ExtensionManager] Error calling onViewSearch for ${extensionId}: ${error}`);
        }
      }
    } else {
      // Tier 2: Forward search query to iframe via postMessage
      extensionIframeManager.sendViewSearchToExtension(extensionId, query);
    }
  }

  private async handleExtensionSubmit(query: string): Promise<void> {
    const currentView = viewManager.getActiveView();
    if (!currentView) return;

    const extensionId = currentView.split("/")[0];
    const module = this.extensionModulesById.get(extensionId);

    if (module) {
      // Tier 1: Direct call to onViewSubmit
      const extensionInstance = this.resolveExtensionInstance(module);
      if (extensionInstance && typeof extensionInstance.onViewSubmit === "function") {
        try {
          await extensionInstance.onViewSubmit(query);
        } catch (error) {
          logService.error(`[ExtensionManager] Error calling onViewSubmit for ${extensionId}: ${error}`);
        }
        return;
      }
    }

    // Tier 2: Forward submit to iframe via postMessage
    extensionIframeManager.handleExtensionSubmit(extensionId, query);
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
    extensionName?: string
  ): Promise<boolean> {
    logService.info(`Attempting to uninstall extension ID: ${extensionId}`);

    try {
      extensionStateManager.extensionUninstallInProgress = extensionId;

      // Prevent uninstalling built-in features
      if (isBuiltInFeature(extensionId)) {
        logService.error(`Cannot uninstall built-in feature: ${extensionId}`);
        return false;
      }

      // Single Rust call: directory removal + settings cleanup + registry cleanup
      await uninstallExtension(extensionId);

      // TS-only cleanup
      statusBarService.clearItemsForExtension(extensionId);

      // Sync TS settings cache (idempotent — Rust already cleaned the store file)
      settingsService.removeExtensionState(extensionId);

      // If uninstalling the active theme, clear CSS overrides and setting
      const currentSettings = settingsService.getSettings();
      if (currentSettings.appearance?.activeTheme === extensionId) {
        removeTheme();
        await settingsService.updateSettings('appearance', { activeTheme: null });
      }

      // Reload extensions
      logService.info("Reloading extensions and re-syncing index after uninstall...");
      await this.unloadExtensions();
      await this.loadExtensions();
      await this.syncCommandIndex();

      logService.info(`Extension ${extensionId}${extensionName ? ` (${extensionName})` : ''} uninstalled successfully.`);
      return true;
    } catch (error) {
      logService.error(`Failed to uninstall extension ${extensionId}${extensionName ? ` (${extensionName})` : ''}: ${error}`);
      return false;
    } finally {
      extensionStateManager.extensionUninstallInProgress = null;
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


  // Use extensionsById map instead if needed: this.extensionsById.get(id) -> Extension

  /**
   * Installs an extension from a given URL
   * This function delegates to the Tauri command which handles downloading and extracting
   */
  // --- Replacement for installExtensionFromUrl ---
  
  private updateExtensionRecords(): void {
    const records: ExtensionRecord[] = Array.from(this.manifestsById.values()).map(m => ({
      manifest: m,
      isBuiltIn: isBuiltInFeature(m.id),
      enabled: this.isExtensionEnabled(m.id),
      path: m.id // Using id as the path for record identification
    }));
    this._extensionRecords = records;
  }
}

const extensionManagerInstance = new ExtensionManager();

// Compatibility for isReady export
export const isReady = {
    get subscribe() {
        return (fn: (v: boolean) => void) => {
            fn(extensionManagerInstance.isReady);
            return () => {};
        };
    }
};

export const extensionManager = extensionManagerInstance;
export default extensionManagerInstance;
