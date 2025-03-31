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
import { discoverExtensions, isBuiltInExtension } from "./extensionDiscovery";
import { ExtensionBridge } from "asyar-api";
import { logService } from "../log/logService";
import { NotificationService } from "../notification/notificationService";
import { ClipboardHistoryService } from "../clipboard/clipboardHistoryService";
import { actionService } from "../action/actionService";
import { commandService } from "./commandService";
import { performanceService } from "../performance/performanceService";

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
export const activeView = writable<string | null>(null);
export const activeViewSearchable = writable<boolean>(false);
export const extensionUsageStats = writable<Record<string, number>>({});
export const extensionLastUsed = writable<Record<string, number>>({});

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
  private manifests: Map<string, ExtensionManifest> = new Map();
  private extensionManifestMap: Map<Extension, ExtensionManifest> = new Map();
  private initialized = false;
  private savedMainQuery = "";
  currentExtension: Extension | null = null;
  private allLoadedCommands: {
    cmd: ExtensionCommand;
    manifest: ExtensionManifest;
  }[] = [];

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
      await this.loadExtensions();
      const loadMetrics = performanceService.stopTiming("extension-loading");
      logService.custom(
        `🧩 Extensions loaded in ${loadMetrics.duration?.toFixed(2)}ms`,
        "PERF",
        "green"
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
    for (const extension of this.extensions) {
      const manifest = this.extensionManifestMap.get(extension);
      if (manifest) {
        commandService.clearCommandsForExtension(manifest.id);
      }
    }
    await this.bridge.deactivateExtensions();
    this.extensions = [];
    this.manifests.clear();
    this.extensionManifestMap.clear();
    this.allLoadedCommands = [];
    this.initialized = false;
    logService.info("Extensions unloaded and state cleared.");
  }

  async loadExtensions() {
    try {
      performanceService.startTiming("extension-discovery");
      const extensionIds = await discoverExtensions();
      logService.debug(
        `Discovery returned ${extensionIds.length} extension IDs`
      );

      this.extensions = [];
      this.manifests.clear();
      this.extensionManifestMap.clear();
      this.allLoadedCommands = [];

      const extensionPairs = await Promise.all(
        extensionIds.map(async (id) => {
          const path = isBuiltInExtension(id)
            ? `../../built-in-extensions/${id}`
            : `../../extensions/${id}`;
          return this.loadExtensionWithManifest(path);
        })
      );

      let enabledCount = 0;
      let disabledCount = 0;
      for (const [extension, manifest] of extensionPairs) {
        if (extension && manifest) {
          const isBuiltIn =
            manifest.basePath?.includes("built-in-extensions") || false;
          const isEnabled =
            isBuiltIn || settingsService.isExtensionEnabled(manifest.name);

          if (isEnabled) {
            performanceService.trackExtensionLoadStart(manifest.id);
            this.extensions.push(extension);
            this.manifests.set(manifest.name, manifest);
            this.extensionManifestMap.set(extension, manifest);
            this.bridge.registerManifest(manifest);
            this.bridge.registerExtensionImplementation(manifest.id, extension);

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
      this.extensions = [];
      this.manifests.clear();
      this.extensionManifestMap.clear();
      this.allLoadedCommands = [];
    }
  }

  private registerCommandHandlersFromManifests(): void {
    this.allLoadedCommands.forEach(({ cmd, manifest }) => {
      try {
        const extension = this.extensions.find(
          (ext) => this.extensionManifestMap.get(ext)?.id === manifest.id
        );
        if (!extension) {
          return;
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
      } catch (error) {}
    });
    logService.info(`Registered command handlers for enabled extensions.`);
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
        await this.unloadExtensions();
        await this.loadExtensions();
        await this.syncCommandIndex();
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
          const manifestPath = `../../extensions/${id}/manifest.json`;
          const manifest = await import(/* @vite-ignore */ manifestPath);

          if (manifest) {
            allExtensions.push({
              title: manifest.name,
              subtitle: manifest.description,
              type: manifest.type,
              keywords: manifest.commands
                ?.map((cmd: any) => cmd.trigger || cmd.name)
                .join(" "),
              enabled: settingsService.isExtensionEnabled(manifest.name),
              id: id,
              version: manifest.version || "N/A",
            });
          }
        } catch (error) {
          logService.warn(
            `Error loading manifest for potential extension ${id}: ${error}`
          );
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
    const extensionId = viewPath.split("/")[0];
    const manifest = Array.from(this.manifests.values()).find(
      (m) => m.id === extensionId
    );

    if (manifest) {
      logService.info(
        `EXTENSION_VIEW_OPENED: Extension view opened: ${viewPath} for extension: ${manifest.id}`
      );
      const now = Date.now();
      extensionUsageStats.update((stats) => {
        return stats;
      });
      extensionLastUsed.update((stats) => {
        return stats;
      });

      this.savedMainQuery = get(searchQuery);
      searchQuery.set("");

      this.currentExtension =
        this.extensions.find(
          (ext) => this.extensionManifestMap.get(ext)?.id === manifest.id
        ) || null;

      activeViewSearchable.set(manifest.searchable ?? false);
      activeView.set(viewPath);

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
    const currentViewPath = get(activeView);
    if (
      this.currentExtension &&
      typeof this.currentExtension.viewDeactivated === "function"
    ) {
      try {
        this.currentExtension.viewDeactivated(currentViewPath);
      } catch (error) {
        const extId = this.getExtensionId(this.currentExtension) || "unknown";
        logService.error(`Error during viewDeactivated for ${extId}: ${error}`);
      }
    }
    this.currentExtension = null;
    activeViewSearchable.set(false);
    searchQuery.set(this.savedMainQuery);
    activeView.set(null);
    logService.debug(`Closed view, restored query: "${this.savedMainQuery}"`);
  }

  async getAllExtensions(): Promise<any[]> {
    logService.warn(
      "getAllExtensions returning data based on loaded manifests, may not reflect searchable state accurately."
    );
    const allItems: any[] = [];
    this.manifests.forEach((manifest) => {
      allItems.push({
        title: manifest.name,
        subtitle: manifest.description,
        keywords:
          manifest.commands?.map((cmd) => cmd.trigger || cmd.name).join(" ") ||
          "",
        type: manifest.type,
        action: () => {
          if (manifest.type === "view" && manifest.defaultView) {
            this.navigateToView(`${manifest.id}/${manifest.defaultView}`);
          } else if (manifest.commands && manifest.commands.length > 0) {
            logService.info(
              `Default action triggered for non-view extension: ${manifest.id}`
            );
          }
        },
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

      if (settingsService.isExtensionEnabled(extensionName)) {
        logService.debug(
          `Disabling extension '${extensionName}' before uninstall.`
        );
        await settingsService.updateExtensionState(extensionName, false);
      }

      const extensionsDir = await this.getExtensionsDirectory();
      const extensionPath = await join(extensionsDir, extensionId);

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

      await settingsService.removeExtensionState(extensionName);
      logService.debug(`Removed settings for extension: ${extensionName}`);

      logService.info(
        "Reloading extensions and re-syncing index after uninstall..."
      );
      await this.unloadExtensions();
      await this.loadExtensions();
      await this.syncCommandIndex();

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

  getExtensionId(extension: Extension): string | undefined {
    return this.extensionManifestMap.get(extension)?.id;
  }
}

export default new ExtensionManager();
