import { settingsService } from "../settings/settingsService.svelte";
import * as commands from "../../lib/ipc/commands";
import type {
  Extension,
  ExtensionManifest,
  ExtensionResult,
  IExtensionManager,
  ExtensionCommand,
} from "asyar-sdk/contracts";

import type { ExtendedManifest } from '../../types/ExtendedManifest';
import { isBuiltInFeature } from "./extensionDiscovery";
import { extensionBridge, type ExtensionBridge } from "asyar-sdk/contracts";
import { logService } from "../log/logService";
import { actionService } from "../action/actionService.svelte";

import { commandService } from "./commandService.svelte";
import { performanceService } from "../performance/performanceService.svelte";
import { viewManager } from "./viewManager.svelte";
import type { ExtensionRecord } from "../../types/ExtensionRecord";

import { searchService } from "../search/SearchService";
import { invalidateTopItemsCache } from "../search/topItemsCache";
import { applyTheme } from '../theme/themeService';
import { ExtensionIpcRouter } from "./ExtensionIpcRouter";
import { ExtensionLoader } from "./ExtensionLoader";
import { resetLauncherState } from "../../lib/launcher/launcherReset";
import type { ServiceRegistry } from "./defineServiceRegistry";
import { buildServiceRegistry } from './buildServiceRegistry';
import { ExtensionEventSubscriptions } from './extensionEventSubscriptions';
import { TimerBridge } from '../timers/timerBridge.svelte';
import { dispatch } from './extensionDispatcher.svelte';

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
import {
  getBuiltinDynamicDispatcher,
  isBuiltinDynamicExtension,
} from "./builtinDynamicDispatchers";

/**
 * Manages application extensions
 */
// Explicitly export the class for type imports
export class ExtensionManager implements IExtensionManager {
  private bridge: ExtensionBridge = extensionBridge;
  private manifestsById: Map<string, ExtendedManifest> = new Map();
  private extensionModulesById: Map<string, LoadedExtensionModule> = new Map();
  private initialized = false;
  private eventSubscriptions = new ExtensionEventSubscriptions();
  private timerBridge = new TimerBridge();
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

  private readonly serviceRegistry: ServiceRegistry;
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
    this.serviceRegistry = buildServiceRegistry({
      extensionManager: this,
      getManifestById: this.getManifestById.bind(this),
      handleCommandAction: this.handleCommandAction.bind(this),
    });


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
          logService.error(`Failed to apply persisted theme on startup: ${err}`);
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
      const firstViewComponentById = new Map(
        this._extensionRecords.map((r) => [r.manifest.id, r.firstViewComponent]),
      );
      extensionSearchAggregator.init(
        this.extensionModulesById,
        this.manifestsById,
        this.isExtensionEnabled.bind(this),
        this.navigateToView.bind(this),
        firstViewComponentById,
      );
      extensionStateManager.init(this.manifestsById, this.reloadExtensionsFilesAndSync.bind(this));

      // Initialize ViewManager *after* manifests are loaded
      viewManager.init(this.manifestsById);

      viewManager.setModuleResolver({
        getModule: (id: string) => this.extensionModulesById.get(id),
        resolveInstance: (module) => extensionSearchAggregator.resolveExtensionInstance(module as any),
      });

      performanceService.startTiming("command-index-sync");
      await this.syncCommandIndex(); 
      const syncMetrics = performanceService.stopTiming("command-index-sync");
      logService.custom(
        `🔄 Commands index synced in ${syncMetrics.duration?.toFixed(2)}ms`,
        "PERF",
        "blue"
      );

      this.updateExtensionRecords();

      // Start listening for scheduled command ticks and preference changes
      // from Rust. Both listeners are managed by ExtensionEventSubscriptions.
      // The TimerBridge listens for one-shot persistent timer fires on the
      // `asyar:timer:fire` Tauri event and forwards them to the target iframe.
      await this.eventSubscriptions.subscribe({
        isExtensionEnabled: this.isExtensionEnabled.bind(this),
        executeCommand: (objectId, args) => commandService.executeCommand(objectId, args),
        reloadExtensions: this.reloadExtensions.bind(this),
        getManifestById: this.getManifestById.bind(this),
      });
      await this.timerBridge.subscribe({
        isExtensionEnabled: this.isExtensionEnabled.bind(this),
      });

      this.initialized = true;
      return true;
    } catch (error) {
      logService.error(`Failed to initialize extension manager: ${error}`);
      return false;
    }
  }

  public async handleCommandAction(commandObjectId: string, args?: Record<string, any>): Promise<any> {
    logService.debug(`Handling command action for: ${commandObjectId}`);

    const dyn = parseDynamicObjectId(commandObjectId);
    if (dyn) {
      const builtinDispatcher = getBuiltinDynamicDispatcher(dyn.extensionId);
      if (builtinDispatcher) {
        // Tier 1 built-in dynamic command — dispatched by the built-in
        // extension's own handler, registered at module load via
        // registerBuiltinDynamicDispatcher (see builtinDynamicDispatchers.ts).
        await builtinDispatcher(dyn.dynamicId, args);
        void commands.recordItemUsage(commandObjectId)
          .then(() => invalidateTopItemsCache())
          .catch((err) =>
            logService.error(`Failed to record usage for ${commandObjectId}: ${err}`)
          );
        return { type: 'no-view' };
      }
      // Tier 2 extension dynamic command — route to the worker iframe dispatcher.
      return this.handleDynamicCommandAction(dyn, commandObjectId, args);
    }

    try {
      const result = await commandService.executeCommand(commandObjectId, args);
      if (result?.type === 'no-view') {
        searchService.saveIndex();
        void commands.hideWindow().then(resetLauncherState);
      } else if (result?.type === 'view' && typeof result.viewPath === 'string') {
        this.navigateToView(result.viewPath);
      }
      // --- Add usage recording ---
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
      // --- End usage recording ---
      return result;
    } catch (error) {
      logService.error(
        `Error handling command action for ${commandObjectId}: ${error}`
      );
      throw error;
    }
  }

  /**
   * Dispatch a dynamic command's execute envelope to the worker iframe
   * that owns the registration. Mirrors the Tier 2 manifest-command
   * stub registered by `ExtensionLoader.registerCommandHandlersFromManifests`,
   * but the registration happens at runtime via
   * `commandsService.replaceDynamicCommands` so there is no stub to
   * register up-front — we recognize the id pattern and dispatch
   * straight from here instead.
   *
   * Always uses `commandMode: 'background'` because dynamic commands
   * register from a worker iframe by design (the launcher's IPC handler
   * rejects calls from extensions without `background.main`).
   */
  private async handleDynamicCommandAction(
    parsed: { extensionId: string; dynamicId: string },
    commandObjectId: string,
    args?: Record<string, any>,
  ): Promise<any> {
    try {
      await dispatch({
        extensionId: parsed.extensionId,
        kind: 'command',
        payload: { commandId: parsed.dynamicId, args: args ?? {} },
        source: 'search',
        commandMode: 'background',
      });

      searchService.saveIndex();
      void commands.hideWindow().then(resetLauncherState);

      commands.recordItemUsage(commandObjectId)
        .then(() => invalidateTopItemsCache())
        .catch((err) =>
          logService.error(
            `Failed to record usage for ${commandObjectId}: ${err}`,
          ),
        );
      return { type: 'no-view' };
    } catch (error) {
      logService.error(
        `Error dispatching dynamic command ${commandObjectId}: ${error}`,
      );
      throw error;
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
    this.eventSubscriptions.unsubscribe();
    this.timerBridge.unsubscribe();

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

  /**
   * Resolve a `cmd_<extensionId>_<commandId>` object id into its manifest
   * metadata + declared argument list, or fall back to the Rust dynamic
   * command registry when the id matches the dynamic format
   * `cmd_<extensionId>_dyn_<dynamicId>`. Used by `CommandArgumentsService`
   * to enter argument mode.
   *
   * Parsing cannot rely on a single separator since extension ids contain
   * dots and command ids contain hyphens; we match each manifest id as a
   * candidate prefix and accept the first whose remainder is a known
   * command id. Manifest scan is sync and cheap; the dynamic fallback
   * round-trips to Rust only for ids that look dynamic, so manifest-only
   * codepaths pay no IPC cost.
   *
   * Returns `null` when neither path resolves the id.
   */
  public async getCommandArgMeta(commandObjectId: string): Promise<{
    extensionId: string;
    commandId: string;
    commandName: string;
    isBuiltIn: boolean;
    icon?: string;
    args: import('asyar-sdk/contracts').CommandArgument[];
    mode?: 'view' | 'background';
    isDynamic?: boolean;
  } | null> {
    if (!commandObjectId.startsWith('cmd_')) return null;
    const rest = commandObjectId.slice(4);
    for (const manifest of this.manifestsById.values()) {
      const prefix = `${manifest.id}_`;
      if (!rest.startsWith(prefix)) continue;
      const commandId = rest.slice(prefix.length);
      const cmd = manifest.commands?.find((c) => c.id === commandId);
      if (!cmd) continue;
      return {
        extensionId: manifest.id,
        commandId,
        commandName: cmd.name,
        isBuiltIn: isBuiltInFeature(manifest.id),
        icon: (cmd as { icon?: string }).icon ?? (manifest as { icon?: string }).icon,
        args: (cmd as { arguments?: import('asyar-sdk/contracts').CommandArgument[] }).arguments ?? [],
        mode: (cmd as { mode?: 'view' | 'background' }).mode,
        isDynamic: false,
      };
    }

    // Dynamic command fallback. Only round-trip for ids that look dynamic
    // — manifest-format misses are conclusive nulls.
    if (parseDynamicObjectId(commandObjectId) === null) return null;
    try {
      const reply = await commands.getDynamicCommandMeta(commandObjectId);
      if (!reply) return null;
      return {
        extensionId: reply.extensionId,
        commandId: reply.commandId,
        commandName: reply.commandName,
        isBuiltIn: isBuiltinDynamicExtension(reply.extensionId),
        icon: reply.icon,
        args: reply.args as import('asyar-sdk/contracts').CommandArgument[],
        // Dynamic commands run through the Tier 2 worker by default. Built-in
        // dynamic extensions (registered via registerBuiltinDynamicDispatcher)
        // are routed by handleCommandAction back to their Tier 1 handler.
        mode: 'background',
        isDynamic: true,
      };
    } catch (err) {
      logService.warn(
        `[ExtensionManager] getDynamicCommandMeta failed for ${commandObjectId}: ${err}`
      );
      return null;
    }
  }

  /**
   * Sync gate for keypress handlers that need to decide before calling
   * `event.preventDefault()` whether a Tab on the selected command should
   * promote into argument-entry mode. Cannot await IPC, so for dynamic
   * commands this is *optimistic* — any object id matching the dynamic
   * format returns true. The actual schema is resolved asynchronously
   * inside `CommandArgumentsService.enter()`.
   *
   * For manifest commands this is conclusive: returns true only when the
   * command's manifest declaration carries a non-empty `arguments[]`.
   */
  public couldHaveArguments(commandObjectId: string): boolean {
    if (!commandObjectId.startsWith('cmd_')) return false;
    const rest = commandObjectId.slice(4);
    for (const manifest of this.manifestsById.values()) {
      const prefix = `${manifest.id}_`;
      if (!rest.startsWith(prefix)) continue;
      const commandId = rest.slice(prefix.length);
      const cmd = manifest.commands?.find((c) => c.id === commandId);
      if (!cmd) continue;
      const args = (cmd as { arguments?: unknown[] }).arguments;
      return Array.isArray(args) && args.length > 0;
    }
    // Manifest scan missed. If the id looks dynamic, optimistically allow
    // entry — the async resolver will short-circuit the actual `enter()`
    // when the registry has no entry or the entry has no args.
    return parseDynamicObjectId(commandObjectId) !== null;
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
    return extensionStateManager.uninstallExtension(
      extensionId,
      extensionName,
      this.reloadExtensionsFilesAndSync.bind(this),
    );
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

/**
 * Parse `cmd_<extensionId>_dyn_<dynamicId>` into its parts. Returns
 * `null` when the id does not match the dynamic format.
 *
 * Splits from the *right* on `_dyn_` to handle the rare case where an
 * extension id literally contains `_dyn_`. Mirrors the Rust-side
 * `parse_dynamic_object_id` in `commands/dynamic_commands.rs` so both
 * sides interpret ambiguous ids identically.
 */
function parseDynamicObjectId(
  objectId: string,
): { extensionId: string; dynamicId: string } | null {
  if (!objectId.startsWith('cmd_')) return null;
  const rest = objectId.slice(4);
  const idx = rest.lastIndexOf('_dyn_');
  if (idx <= 0) return null;
  const extensionId = rest.slice(0, idx);
  const dynamicId = rest.slice(idx + '_dyn_'.length);
  if (!extensionId || !dynamicId) return null;
  return { extensionId, dynamicId };
}
