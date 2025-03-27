import { writable, get } from "svelte/store";
import { searchQuery } from "../stores/search";
import { settingsService } from "./settingsService";
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
import type { Command } from "./search/types/Command";

// Stores for extension state
export const extensionUninstallInProgress = writable<string | null>(null);
export const activeView = writable<string | null>(null);
export const activeViewSearchable = writable<boolean>(false);
export const extensionUsageStats = writable<Record<string, number>>({});
// New store for tracking when extensions were last used
export const extensionLastUsed = writable<Record<string, number>>({});

/**
 * Index an extension command in the search engine
 * @param cmdData The command data to index
 */
async function indexExtensionCommand(cmdData: Command) {
  // Make sure the 'type' field here maps to 'extension_type' in Rust struct
  const payload = {
    ...cmdData,
    extensionType: cmdData.type, // Rename if necessary based on Serde config
  };

  try {
    // Pass item directly, Serde handles the 'category' tag
    await invoke("index_item", { item: payload, category: "command" });
    logService.debug(`Indexed command: ${cmdData.name}`);
  } catch (error) {
    logService.error(`Failed to index extension command: ${error}`);
  }
}

/**
 * Manages application extensions
 */
class ExtensionManager {
  private bridge = ExtensionBridge.getInstance();
  private extensions: Extension[] = [];
  private manifests: Map<string, ExtensionManifest> = new Map();
  private extensionManifestMap: Map<Extension, ExtensionManifest> = new Map(); // Direct mapping between extension and manifest
  private initialized = false;
  private savedMainQuery = "";
  currentExtension: any;
  private commandMap: Map<string, ExtensionCommand> = new Map();

  constructor() {
    // Register the ExtensionManager itself to provide the extensions ability to navigate to views
    this.bridge.registerService("ExtensionManager", this);
    // Register base app services with the bridge
    this.bridge.registerService("LogService", logService);
    this.bridge.registerService(
      "NotificationService",
      new NotificationService()
    );
    this.bridge.registerService(
      "ClipboardHistoryService",
      ClipboardHistoryService.getInstance()
    );
    // Register the ActionService
    this.bridge.registerService("ActionService", actionService);
    // Register the CommandService
    this.bridge.registerService("CommandService", commandService);

    // Register UI components
    this.bridge.registerComponent("Button", Button);
    this.bridge.registerComponent("Input", Input);
    this.bridge.registerComponent("Card", Card);
    this.bridge.registerComponent("Toggle", Toggle);
    this.bridge.registerComponent("SplitView", SplitView);
    this.bridge.registerComponent("ShortcutRecorder", ShortcutRecorder);
    this.bridge.registerComponent("ConfirmDialog", ConfirmDialog);
  }

  /**
   * Initialize the extension manager
   */
  async init(): Promise<boolean> {
    if (this.initialized) return true;

    try {
      logService.custom("🔄 Initializing extension manager...", "EXTN", "blue");

      // Initialize performance service first (if not already initialized)
      if (!performanceService.init) {
        await performanceService.init();
        logService.custom(
          "🔍 Performance monitoring initialized by extension manager",
          "PERF",
          "cyan"
        );
      }

      // Ensure settings are loaded first
      if (!settingsService.isInitialized()) {
        await settingsService.init();
      }

      // Load extensions with performance tracking
      performanceService.startTiming("extension-loading");
      await this.loadExtensions();
      const loadMetrics = performanceService.stopTiming("extension-loading");

      logService.custom(
        `🧩 Extensions loaded in ${loadMetrics.duration?.toFixed(2)}ms`,
        "PERF",
        "green"
      );

      this.initialized = true;
      return true;
    } catch (error) {
      logService.error(`Failed to initialize extension manager: ${error}`);
      return false;
    }
  }

  async unloadExtensions(): Promise<void> {
    // Clean up any registered commands
    for (const extension of this.extensions) {
      const manifest = this.extensionManifestMap.get(extension);
      if (manifest) {
        commandService.clearCommandsForExtension(manifest.id);
      }
    }

    await this.bridge.deactivateExtensions();
  }

  /**
   * Load all available extensions
   */
  async loadExtensions() {
    try {
      // Discover available extensions
      performanceService.startTiming("extension-discovery");
      const extensionIds = await discoverExtensions();
      const discoveryMetrics = performanceService.stopTiming(
        "extension-discovery"
      );

      logService.custom(
        `🔍 Discovered ${
          extensionIds.length
        } extensions in ${discoveryMetrics.duration?.toFixed(2)}ms`,
        "EXTN",
        "blue"
      );
      logService.debug(`Extensions: ${extensionIds.join(", ")}`);

      // Clear existing extensions
      this.extensions = [];
      this.manifests.clear();
      this.extensionManifestMap.clear();
      this.commandMap.clear();

      // Load discovered extensions
      const extensionPairs = await Promise.all(
        extensionIds.map((id) =>
          this.loadExtensionWithManifest(`../extensions/${id}`)
        )
      );

      // Add enabled extensions
      let enabledCount = 0;
      let disabledCount = 0;

      for (const [extension, manifest] of extensionPairs) {
        if (extension && manifest) {
          // Check if extension is enabled
          const isEnabled = settingsService.isExtensionEnabled(manifest.name);

          if (isEnabled) {
            // Track extension loading
            performanceService.trackExtensionLoadStart(manifest.id);

            this.extensions.push(extension);
            this.manifests.set(manifest.name, manifest);
            this.extensionManifestMap.set(extension, manifest);

            // Register the manifest with the bridge
            this.bridge.registerManifest(manifest);

            // Register the extension implementation with the bridge
            this.bridge.registerExtensionImplementation(manifest.id, extension);

            // Cache the commands for quick lookup
            if (manifest.commands) {
              for (const cmd of manifest.commands) {
                this.commandMap.set(`${manifest.id}.${cmd.id}`, cmd);
              }
            }

            // Track extension load completion
            performanceService.trackExtensionLoadEnd(manifest.id);

            enabledCount++;
          } else {
            disabledCount++;
          }
        }
      }

      // Initialize and activate extensions via the bridge
      performanceService.startTiming("extension-initialization");
      await this.bridge.initializeExtensions();
      await this.bridge.activateExtensions();
      performanceService.stopTiming("extension-initialization");

      // Register commands from manifests
      this.registerCommandsFromManifests();

      logService.debug(
        `Extensions loaded: ${enabledCount} enabled, ${disabledCount} disabled`
      );
    } catch (error) {
      logService.error(`Failed to load extensions: ${error}`);
      this.extensions = [];
      this.manifests.clear();
      this.extensionManifestMap.clear();
      this.commandMap.clear();
    }
  }

  /**
   * Register commands from manifests
   * This replaces the need for extensions to implement registerCommands()
   */
  private registerCommandsFromManifests(): void {
    for (const extension of this.extensions) {
      try {
        const manifest = this.extensionManifestMap.get(extension);
        if (!manifest || !manifest.commands || manifest.commands.length === 0) {
          continue;
        }

        logService.debug(`Registering commands for extension: ${manifest.id}`);

        // Register each command in the manifest
        for (const cmd of manifest.commands) {
          // Create a command handler that delegates to the extension's executeCommand method
          const handler = {
            execute: async (args?: Record<string, any>) => {
              try {
                return await extension.executeCommand(cmd.id, args);
              } catch (error) {
                logService.error(
                  `Error executing command ${cmd.id} in extension ${manifest.id}: ${error}`
                );
                throw error;
              }
            },
          };

          // Register the command with the command service
          commandService.registerCommand(
            `${manifest.id}.${cmd.id}`,
            handler,
            manifest.id
          );

          // Index the command for search
          const commandData: Command = {
            category: "command", // Required by Command interface
            id: cmd.id,
            name: cmd.name,
            trigger: cmd.trigger || cmd.name, // Use name as fallback if trigger missing
            extension: manifest.id, // Extension identifier
            type: manifest.type, // Default type if not specified
          };

          indexExtensionCommand(commandData);

          logService.debug(
            `Registered command: ${cmd.id} for extension: ${manifest.id}`
          );
        }

        logService.info(
          `Registered ${manifest.commands.length} commands for extension: ${manifest.id}`
        );
      } catch (error) {
        const extensionId = this.getExtensionId(extension) || "unknown";
        logService.error(
          `Error registering commands for extension ${extensionId}: ${error}`
        );
      }
    }
  }

  /**
   * Load extension and its manifest
   */
  private async loadExtensionWithManifest(
    path: string
  ): Promise<[Extension | null, ExtensionManifest | null]> {
    try {
      performanceService.startTiming(`load-extension:${path}`);

      const [extensionModule, manifest] = await Promise.all([
        import(/* @vite-ignore */ path),
        import(/* @vite-ignore */ `${path}/manifest.json`),
      ]);

      // Make sure we get the default export
      const extension = extensionModule.default as Extension;

      if (!extension) {
        logService.error(
          `Invalid extension loaded from ${path}: missing default export`
        );
        return [null, null];
      }

      // Validate that the extension properly implements the required interface
      if (typeof extension.executeCommand !== "function") {
        logService.error(
          `Invalid extension loaded from ${path}: missing required executeCommand method`
        );
        return [null, null];
      }

      logService.info(`Loading extension: ${manifest.id} (${manifest.name})`);

      const metrics = performanceService.stopTiming(`load-extension:${path}`);
      logService.debug(
        `Loaded extension from ${path} in ${metrics.duration?.toFixed(2)}ms`
      );

      // Return the extension and manifest without registering yet
      // Registration will happen in loadExtensions after checking enabled status
      return [extension, manifest];
    } catch (error) {
      logService.error(`Failed to load extension from ${path}: ${error}`);
      return [null, null];
    }
  }

  /**
   * Check if an extension is enabled
   */
  isExtensionEnabled(extensionName: string): boolean {
    return settingsService.isExtensionEnabled(extensionName);
  }

  /**
   * Toggle extension enabled/disabled state
   */
  async toggleExtensionState(
    extensionName: string,
    enabled: boolean
  ): Promise<boolean> {
    try {
      return await settingsService.updateExtensionState(extensionName, enabled);
    } catch (error) {
      logService.error(`Failed to toggle extension state: ${error}`);
      return false;
    }
  }

  /**
   * Get all extensions with their enabled state
   */
  async getAllExtensionsWithState(): Promise<any[]> {
    try {
      const extensionIds = await discoverExtensions();
      const allExtensions: Array<any> = [];

      for (const id of extensionIds) {
        try {
          const manifest = await import(
            /* @vite-ignore */ `../extensions/${id}/manifest.json`
          );

          if (manifest) {
            allExtensions.push({
              title: manifest.name,
              subtitle: manifest.description,
              type: manifest.type,
              keywords: manifest.commands
                ?.map((cmd: any) => cmd.trigger)
                .join(" "),
              enabled: this.isExtensionEnabled(manifest.name),
              id: id,
              version: manifest.version || "1.0",
            });
          }
        } catch (error) {
          logService.error(`Error loading extension ${id}: ${error}`);
        }
      }

      return allExtensions;
    } catch (error) {
      logService.error(`Error retrieving all extensions: ${error}`);
      return [];
    }
  }

  /**
   * Handle search in the current extension view
   */
  async handleViewSearch(query: string): Promise<void> {
    if (this.currentExtension?.onViewSearch) {
      await this.currentExtension.onViewSearch(query);
    }
  }

  /**
   * Navigate to an extension view
   */
  navigateToView(viewPath: string): void {
    const extensionName = viewPath.split("/")[0];

    // Find manifest by exact name
    const manifest = Array.from(this.manifests.values()).find(
      (m) => m.id.toLowerCase() === extensionName.toLowerCase()
    );

    if (manifest) {
      // Track extension navigation
      logService.info(
        `EXTENSION_VIEW_OPENED: Extension view opened: ${viewPath} for extension: ${manifest.id}`
      );

      // Update usage statistics
      const now = Date.now();
      extensionUsageStats.update((stats) => {
        const key = manifest.id;
        stats[key] = (stats[key] || 0) + 1;
        return stats;
      });

      // Update last used timestamp
      extensionLastUsed.update((stats) => {
        stats[manifest.id] = now;
        return stats;
      });

      // Save current query for when we return to main view
      this.savedMainQuery = get(searchQuery);

      // Clear search when navigating to extension view
      searchQuery.set("");

      // Find the extension instance that corresponds to this manifest
      this.currentExtension = this.extensions.find(
        (ext) => this.extensionManifestMap.get(ext)?.id === manifest.id
      );

      // Update searchable state and view
      activeViewSearchable.set(manifest.searchable ?? false);
      activeView.set(viewPath);

      // Notify the extension that its view is now active (if it has a viewActivated method)
      if (
        this.currentExtension &&
        typeof this.currentExtension.viewActivated === "function"
      ) {
        this.currentExtension.viewActivated(viewPath);
      }

      logService.debug(
        `Navigating to view: ${viewPath}, searchable: ${manifest.searchable}`
      );
    } else {
      logService.error(`No manifest found for extension: ${extensionName}`);
    }
  }

  /**
   * Close the current view and return to main screen
   */
  closeView(): void {
    // Notify the extension that its view is being deactivated
    if (
      this.currentExtension &&
      typeof this.currentExtension.viewDeactivated === "function"
    ) {
      this.currentExtension.viewDeactivated();
    }

    this.currentExtension = null;
    activeViewSearchable.set(false);

    // Restore main search query
    searchQuery.set(this.savedMainQuery);
    activeView.set(null);
  }

  /**
   * Get all loaded extensions without filtering
   */
  async getAllExtensions(): Promise<any[]> {
    const allItems: any[] = [];

    // Add basic extension information
    for (const [index, extension] of this.extensions.entries()) {
      const manifest = Array.from(this.manifests.values())[index];

      // Re-enable showing extensions in search results
      if (manifest) {
        allItems.push({
          title: manifest.name,
          subtitle: manifest.description,
          keywords:
            manifest.commands?.map((cmd) => cmd.trigger).join(" ") || "",
          type: manifest.type,
          action: () => {
            if (manifest.type === "view") {
              this.navigateToView(`${manifest.id}/${manifest.defaultView}`);
            }
          },
        });
      }
    }

    return allItems;
  }

  /**
   * Uninstall an extension
   */
  async uninstallExtension(
    extensionId: string,
    extensionName: string
  ): Promise<boolean> {
    try {
      extensionUninstallInProgress.set(extensionId);

      // First disable the extension if active
      if (this.manifests.has(extensionName)) {
        await this.toggleExtensionState(extensionName, false);
      }

      // Get extension directory path
      const extensionsDir = await this.getExtensionsDirectory();
      const extensionPath = await join(extensionsDir, extensionId);

      // Add safety checks
      if (extensionPath.length < 10 || !extensionPath.includes("extensions")) {
        logService.error(
          `Safety check failed: Invalid extension path ${extensionPath}`
        );
        return false;
      }

      // Verify this is an extension directory
      const manifestPath = await join(extensionPath, "manifest.json");
      const manifestExists = await invoke("check_path_exists", {
        path: manifestPath,
      });

      if (!manifestExists) {
        logService.error(`No manifest.json found at ${manifestPath}`);
      }

      // Try Rust-side deletion first
      try {
        await invoke("delete_extension_directory", { path: extensionPath });
      } catch (rustError) {
        logService.error(`Rust directory deletion failed: ${rustError}`);

        // Fall back to JS-side deletion
        try {
          const pathExists = await invoke("check_path_exists", {
            path: extensionPath,
          });

          if (pathExists) {
            await remove(extensionPath, { recursive: true });
          } else {
            logService.error(`Extension directory not found: ${extensionPath}`);
          }
        } catch (jsError) {
          logService.error(`JS-side directory deletion failed: ${jsError}`);
          return false;
        }
      }

      // Remove from extension settings
      await settingsService.removeExtensionState(extensionName);

      // Force a refresh
      await this.loadExtensions();

      return true;
    } catch (error) {
      logService.error(
        `Failed to uninstall extension ${extensionId}: ${error}`
      );
      return false;
    } finally {
      extensionUninstallInProgress.set(null);
    }
  }

  /**
   * Get the directory where extensions are stored
   */
  private async getExtensionsDirectory(): Promise<string> {
    try {
      // Check environment
      const isDev = import.meta.env?.DEV === true;

      if (isDev) {
        // Development path
        return "/Users/khoshbinali/development/asyar/src/extensions";
      } else {
        // Production path
        const appDirectory = await appDataDir();
        return await join(appDirectory, "extensions");
      }
    } catch (error) {
      logService.error(`Failed to get extensions directory: ${error}`);

      // Fallback to resource directory
      const resourceDirectory = await resourceDir();
      return await join(resourceDirectory, "extensions");
    }
  }

  /**
   * Get manifest for an extension instance
   */
  getManifestForExtension(extension: Extension): ExtensionManifest | undefined {
    return this.extensionManifestMap.get(extension);
  }

  /**
   * Get extension ID from extension instance
   */
  getExtensionId(extension: Extension): string | undefined {
    return this.extensionManifestMap.get(extension)?.id;
  }

  /**
   * Get extension name from extension instance
   */
  getExtensionName(extension: Extension): string | undefined {
    return this.extensionManifestMap.get(extension)?.name;
  }

  /**
   * Get extension version from extension instance
   */
  getExtensionVersion(extension: Extension): string | undefined {
    return this.extensionManifestMap.get(extension)?.version;
  }
}

export default new ExtensionManager();
