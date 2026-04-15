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
import { fileManagerService } from '../fileManager/fileManagerService';

import { commandService } from "./commandService.svelte";
import { aiExtensionService } from '../ai/aiService.svelte';
import { performanceService } from "../performance/performanceService.svelte";
import { viewManager } from "./viewManager.svelte";
import { shellService } from "../shell/shellService.svelte";
import { envService } from "../envService";
import { selectionService } from "../selection/selectionService";
import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';
import type { ExtensionRecord } from "../../types/ExtensionRecord";
import { applicationService } from "../application/applicationService";
import { windowManagementService } from '../windowManagement/windowManagementService';

import { searchService } from "../search/SearchService";
import { invalidateTopItemsCache } from "../search/topItemsCache";
import { applyTheme, removeTheme } from '../theme/themeService';
import { ExtensionIpcRouter } from "./ExtensionIpcRouter";
import { extensionStorageService } from "../storage/extensionStorageService";
import { extensionCacheService } from "../storage/extensionCacheService";
import { extensionOAuthService } from "../oauth/extensionOAuthService.svelte";
import { ExtensionLoader } from "./ExtensionLoader";
import { InteropService } from "../interop/interopService.svelte";

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
  private unlistenScheduler: (() => void) | null = null;
  private unlistenPreferencesChanged: (() => void) | null = null;
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
    // asyar:api:* messages without allocating on every call.
    this.serviceRegistry = {
      'log': logService,
      'extensions': this,
      'notifications': new NotificationService(),
      'clipboard': ClipboardHistoryService.getInstance(),
      'commands': commandService,
      'actions': actionService,
      'settings': {
        get: async (section: string, key: string) => {
          const settings = settingsService.getSettings();
          return (settings as any)[section]?.[key];
        },
        set: async (section: string, key: string, value: any) => {
          return settingsService.updateSettings(section as any, { [key]: value });
        }
      },
      'statusBar': statusBarService,
      'entitlements': {
        check: (entitlement: string) => entitlementService.check(entitlement),
        getAll: () => entitlementService.getAll(),
      },
      'storage': extensionStorageService,
      'cache': extensionCacheService,
      'feedback': feedbackService,
      'selection': selectionService,
      'ai': aiExtensionService,
      'oauth': extensionOAuthService,
      'shell': shellService,
      'fs': fileManagerService,
      'interop': new InteropService({
        hasCommand: (objectId: string) => commandService.commands.has(objectId),
        getManifestById: (id: string) => this.getManifestById(id),
        handleCommandAction: (objectId: string, args?: Record<string, unknown>) => this.handleCommandAction(objectId, args),
      }),
      'application': applicationService,
      'window': windowManagementService,
    };


    extensionIframeManager.init(viewManager);
    actionService.setExtensionForwarder(extensionIframeManager.sendActionExecuteToExtension.bind(extensionIframeManager));
    
    // (Removed: legacy settings-broadcast path that was used exclusively by
    // the Calculator built-in to pick up refreshInterval changes. Calculator
    // now reads its refresh interval from `context.preferences` and is
    // reloaded by extensionManager when preferences change, so no broadcast
    // is needed. If another section needs runtime change notifications in
    // the future, re-introduce a generic broadcast here.)

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

      // Start listening for scheduled command ticks from Rust
      if (envService.isTauri) {
        const { listen } = await import('@tauri-apps/api/event');
        this.unlistenScheduler = await listen<{ extensionId: string; commandId: string }>(
          'asyar:scheduler:tick',
          (event) => {
            this.handleScheduledTick(event.payload.extensionId, event.payload.commandId);
          }
        );
      }

      // Subscribe to preference changes via a Rust-emitted Tauri event so
      // that writes from any webview (main launcher, settings window,
      // future windows) reach this handler. A plain window DOM event
      // would be trapped inside the webview that dispatched it, leaving
      // the other webviews out of sync. The Rust emit happens after the
      // SQL write succeeds (see commands/extension_preferences.rs).
      if (envService.isTauri) {
        const { listen } = await import('@tauri-apps/api/event');
        this.unlistenPreferencesChanged = await listen<{ extensionId: string }>(
          'asyar:preferences-changed',
          async (event) => {
            const extensionId = event.payload?.extensionId;
            if (!extensionId) return;

            // Drop the cached bundle for this extension so the next
            // getEffectivePreferences re-reads fresh values from Rust.
            // Any other webview (e.g. the settings window) that has its
            // own service instance must install the same listener there
            // to keep its cache in sync.
            const { extensionPreferencesService } = await import(
              './extensionPreferencesService.svelte'
            );
            extensionPreferencesService.invalidateCache(extensionId);

            try {
              await this.handlePreferencesChanged(extensionId);
            } catch (err) {
              logService.error(
                `Failed to reload extension ${extensionId} after preferences change: ${err}`
              );
            }
          }
        );
      }

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
      throw error;
    }
  }

  private async handleScheduledTick(extensionId: string, commandId: string): Promise<void> {
    if (!this.isExtensionEnabled(extensionId)) return;

    const objectId = `cmd_${extensionId}_${commandId}`;
    logService.debug(`[Scheduler] Executing scheduled command: ${objectId}`);

    try {
      // Use commandService.executeCommand directly — NOT handleCommandAction,
      // to avoid window-hiding side effects for background execution
      await commandService.executeCommand(objectId, { scheduledTick: true });
    } catch (error) {
      logService.error(`[Scheduler] Failed to execute ${objectId}: ${error}`);
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

  /**
   * React to a preferences change for a single extension. Tier 2 iframes
   * receive a targeted asyar:preferences:set-all postMessage with the fresh
   * bundle; Tier 1 features get a full extension reload because they read
   * `context.preferences` only at boot time.
   */
  private async handlePreferencesChanged(extensionId: string): Promise<void> {
    const manifest = this.manifestsById.get(extensionId);
    if (!manifest) return;

    // Dynamic import to avoid a circular import chain (service -> manager).
    const { extensionPreferencesService } = await import('./extensionPreferencesService.svelte');
    const bundle = await extensionPreferencesService.getEffectivePreferences(extensionId);

    if (isBuiltInFeature(extensionId)) {
      // Tier 1 features cache preferences on their context. A full reload
      // is the cleanest way to hand them the fresh snapshot.
      await this.reloadExtensions();
    } else {
      // Tier 2 iframes can receive the new snapshot via postMessage without
      // a reload — cheaper and faster than tearing down the iframe.
      extensionIframeManager.sendPreferencesToExtension(extensionId, {
        extension: bundle.extension,
        commands: bundle.commands,
      });
    }
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
    this.unlistenScheduler?.();
    this.unlistenScheduler = null;

    this.unlistenPreferencesChanged?.();
    this.unlistenPreferencesChanged = null;

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

// Lazy singleton. Eagerly instantiating at module body (the old pattern)
// coupled ExtensionManager's constructor — which references actionService,
// searchOrchestrator, etc. — to module-load order. When the Settings webview
// entered the module graph via the components barrel, actionService was still
// mid-loading by the time extensionManager's module ran its ctor, producing
// a TDZ crash ("Cannot access 'component' before initialization") that rendered
// a white screen.
//
// By deferring `new ExtensionManager()` to the first property access via a
// Proxy, the module body does nothing beyond defining the class. The ctor runs
// only after every transitive dependency has finished loading, so no cycle
// can exist at module-load time. All 18+ consumers of `extensionManager` /
// the default export continue to work unchanged — the Proxy transparently
// delegates every property read, write, and method call to the real instance.
let _instance: ExtensionManager | null = null;
function getInstance(): ExtensionManager {
    if (!_instance) _instance = new ExtensionManager();
    return _instance;
}

const lazyExtensionManager = new Proxy({} as ExtensionManager, {
    get(_target, prop) {
        return Reflect.get(getInstance(), prop);
    },
    set(_target, prop, value) {
        return Reflect.set(getInstance(), prop, value);
    },
    has(_target, prop) {
        return Reflect.has(getInstance(), prop);
    },
    getPrototypeOf() {
        return Reflect.getPrototypeOf(getInstance());
    },
    // Tools like vi.spyOn / Object.defineProperty reflect on / rewrite property
    // descriptors. Without these traps, they would see the empty Proxy target
    // instead of the real instance.
    getOwnPropertyDescriptor(_target, prop) {
        const instance = getInstance();
        return (
            Object.getOwnPropertyDescriptor(instance, prop) ??
            Object.getOwnPropertyDescriptor(Object.getPrototypeOf(instance), prop)
        );
    },
    defineProperty(_target, prop, descriptor) {
        return Reflect.defineProperty(getInstance(), prop, descriptor);
    },
    ownKeys() {
        return Reflect.ownKeys(getInstance());
    },
});

// Compatibility for isReady export
export const isReady = {
    get subscribe() {
        return (fn: (v: boolean) => void) => {
            fn(lazyExtensionManager.isReady);
            return () => {};
        };
    }
};

export const extensionManager = lazyExtensionManager;
export default lazyExtensionManager;
