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
} from "asyar-extension-sdk";
import { discoverExtensions } from "./extensionDiscovery";
import { ExtensionBridge } from "asyar-extension-sdk";
import { LogService, logService } from "./logService";
import type { IExtensionDiscovery } from "./interfaces/IExtensionDiscovery";
import { NotificationService } from "./notificationService";
import { ClipboardHistoryService } from "./clipboardHistoryService";
import { actionService } from "./actionService";

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

// Stores for extension state
export const extensionUninstallInProgress = writable<string | null>(null);
export const activeView = writable<string | null>(null);
export const activeViewSearchable = writable<boolean>(false);

/**
 * Manages application extensions
 */
class ExtensionManager implements IExtensionManager {
  private bridge = ExtensionBridge.getInstance();
  private extensions: Extension[] = [];
  private manifests: Map<string, ExtensionManifest> = new Map();
  private initialized = false;
  private savedMainQuery = "";
  currentExtension: any;

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
      // Ensure settings are loaded first
      if (!settingsService.isInitialized()) {
        await settingsService.init();
      }

      // Load extensions
      await this.loadExtensions();

      this.initialized = true;
      return true;
    } catch (error) {
      logService.error(`Failed to initialize extension manager: ${error}`);
      return false;
    }
  }

  async unloadExtensions(): Promise<void> {
    await this.bridge.deactivateExtensions();
  }

  /**
   * Load all available extensions
   */
  async loadExtensions() {
    try {
      // Discover available extensions
      const extensionIds = await discoverExtensions();
      logService.info(`Discovered extensions: ${extensionIds.join(", ")}`);

      // Clear existing extensions
      this.extensions = [];
      this.manifests.clear();

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
            this.extensions.push(extension);
            this.manifests.set(manifest.name, manifest);
            enabledCount++;
          } else {
            disabledCount++;
          }
        }
      }

      // very important to initialize extensions after loading extensions, otherwise it will not work
      // Initialize bridge before loading extensions
      await this.bridge.initializeExtensions();
      await this.bridge.activateExtensions();

      logService.debug(
        `Extensions loaded: ${enabledCount} enabled, ${disabledCount} disabled`
      );
    } catch (error) {
      logService.error(`Failed to load extensions: ${error}`);
      this.extensions = [];
      this.manifests.clear();
    }
  }

  /**
   * Load extension and its manifest
   */
  private async loadExtensionWithManifest(
    path: string
  ): Promise<[Extension | null, ExtensionManifest | null]> {
    try {
      const [extensionModule, manifest] = await Promise.all([
        import(/* @vite-ignore */ path),
        import(/* @vite-ignore */ `${path}/manifest.json`),
      ]);

      // Make sure we get the default export
      const extension = extensionModule.default as Extension;

      if (!extension || typeof extension.search !== "function") {
        logService.error(
          `Invalid extension loaded from ${path}: missing search method`
        );
        return [null, null];
      }

      logService.info(`Registering extension: ${extension.id}`);

      this.bridge.registerExtension(extension);
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
   * Search across all extensions
   */
  async searchAll(query: string): Promise<ExtensionResult[]> {
    if (this.extensions.length === 0) {
      return [];
    }

    const results: ExtensionResult[] = [];
    const lowercaseQuery = query.toLowerCase();

    for (let i = 0; i < this.extensions.length; i++) {
      const extension = this.extensions[i];
      const manifest = this.manifests.get(Array.from(this.manifests.keys())[i]);

      if (manifest && this.extensionMatchesQuery(manifest, lowercaseQuery)) {
        const extensionResults = await extension.search(query);
        results.push(...extensionResults);
      }
    }

    return results;
  }

  /**
   * Check if extension matches the query
   */
  private extensionMatchesQuery(
    manifest: ExtensionManifest,
    query: string
  ): boolean {
    return manifest.commands.some((cmd) => {
      const triggers = cmd.trigger.split("");
      return triggers.some((t) => query.startsWith(t.toLowerCase()));
    });
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
      // Save current query for when we return to main view
      this.savedMainQuery = get(searchQuery);

      // Clear search when navigating to extension view
      searchQuery.set("");

      // Set current extension and view state
      this.currentExtension =
        this.extensions[
          Array.from(this.manifests.keys()).indexOf(manifest.name)
        ];

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
   * TODO:: use fuse or cache to fill the search results with highly used extensions
   * when no query is provided
   */
  async getAllExtensions(): Promise<any[]> {
    const allItems: any[] | PromiseLike<any[]> = [];

    // Add basic extension information
    // for (const [index, extension] of this.extensions.entries()) {
    //   const manifest = Array.from(this.manifests.values())[index];

    //   // TODO:: uncomment this after debuggin the extensions
    //   // TODO:: or you may use the fuse.js to search the extensions from the cache
    //   // show all the extensions in the search results using the extension's manifest
    //   // if (manifest) {
    //   //   allItems.push({
    //   //     title: manifest.name,
    //   //     subtitle: manifest.description,
    //   //     keywords: manifest.commands.map((cmd) => cmd.trigger).join(" "),
    //   //     type: manifest.type,
    //   //     action: () => {
    //   //       if (manifest.type === "view") {
    //   //         this.navigateToView(`${manifest.id}/${manifest.defaultView}`);
    //   //       }
    //   //     },
    //   //   });
    //   // }

    //   // Include items from search providers
    //   if (extension.searchProviders) {
    //     for (const provider of extension.searchProviders) {
    //       try {
    //         const items = await provider.getAll();
    //         if (items && Array.isArray(items)) {
    //           allItems.push(...items);
    //         }
    //       } catch (error) {
    //         logService.error(
    //           `Error getting items from search provider: ${error}`
    //         );
    //       }
    //     }
    //   }
    // }

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
}

export default new ExtensionManager() as IExtensionManager;
