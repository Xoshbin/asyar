import { writable, get } from "svelte/store";
import { searchQuery } from "../stores/search";
import { LogService } from "./logService";
import { discoverExtensions } from "./extensionDiscovery";
import { settingsService } from "./settingsService";
// Fix: Use remove instead of remove for directory removal
import { exists, readDir, remove } from "@tauri-apps/plugin-fs";
import { join, resourceDir, appDataDir } from "@tauri-apps/api/path";
// Add dialog API for fallback error handling
import type {
  Extension,
  ExtensionResult,
  ExtensionManifest,
} from "../types/extension";
import { invoke } from "@tauri-apps/api/core";

// Add a store to track uninstall operations
export const extensionUninstallInProgress = writable<string | null>(null);
export const activeView = writable<string | null>(null);
export const activeViewSearchable = writable<boolean>(false);

class ExtensionManager {
  private extensions: Extension[] = [];
  private manifests: Map<string, ExtensionManifest> = new Map();
  private initialized = false;
  currentExtension: any;
  private savedMainQuery: string = "";

  /**
   * Initialize the extension manager
   * Should be called after settings service is initialized
   */
  async init(): Promise<boolean> {
    if (this.initialized) return true;

    try {
      LogService.info("Initializing extension manager...");

      // Ensure settings are loaded first
      if (!settingsService.isInitialized()) {
        LogService.info(
          "Settings service not initialized, initializing now..."
        );
        await settingsService.init();
      }

      // Load extensions
      await this.loadExtensions();

      this.initialized = true;
      LogService.info("Extension manager initialized successfully");
      return true;
    } catch (error) {
      LogService.error(`Failed to initialize extension manager: ${error}`);
      return false;
    }
  }

  async loadExtensions() {
    LogService.info("Starting to load extensions...");
    try {
      // Discover available extensions
      const extensionIds = await discoverExtensions();
      LogService.debug(`Discovered extensions: ${extensionIds.join(", ")}`);

      // Clear existing extensions
      this.extensions = [];
      this.manifests.clear();

      // Load discovered extensions
      const extensionPairs = await Promise.all(
        extensionIds.map((id) =>
          this.loadExtensionWithManifest(`../extensions/${id}`)
        )
      );

      LogService.debug(`${extensionPairs.length} extension modules loaded`);

      // Track skipped extensions for debugging
      let enabledCount = 0;
      let disabledCount = 0;

      for (const [extension, manifest] of extensionPairs) {
        if (extension && manifest) {
          // Check if extension is enabled in settings
          const isEnabled = settingsService.isExtensionEnabled(manifest.name);

          if (isEnabled) {
            // Only add to loaded extensions if it's enabled
            this.extensions.push(extension);
            this.manifests.set(manifest.name, manifest);
            enabledCount++;
            LogService.info(`Loaded extension: ${manifest.name} (enabled)`);
          } else {
            disabledCount++;
            LogService.info(
              `Extension ${manifest.name} is disabled, skipping activation`
            );
          }
        }
      }

      LogService.info(
        `Extensions loaded: ${enabledCount} enabled, ${disabledCount} disabled`
      );
    } catch (error) {
      LogService.error(`Failed to load extensions: ${error}`);
      this.extensions = [];
      this.manifests.clear();
    }
  }

  private async loadExtensionWithManifest(
    path: string
  ): Promise<[Extension | null, ExtensionManifest | null]> {
    try {
      const [extension, manifest] = await Promise.all([
        import(/* @vite-ignore */ path).then((m) => m.default),
        import(/* @vite-ignore */ `${path}/manifest.json`),
      ]);
      return [extension, manifest];
    } catch (error) {
      LogService.error(`Failed to load extension from ${path}: ${error}`);
      return [null, null];
    }
  }

  // Check if an extension is enabled - using settings service
  isExtensionEnabled(extensionName: string): boolean {
    return settingsService.isExtensionEnabled(extensionName);
  }

  // Toggle extension enabled/disabled state - using settings service
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
        LogService.info(
          `Extension ${extensionName} ${enabled ? "enabled" : "disabled"}`
        );
      }
      return success;
    } catch (error) {
      LogService.error(`Failed to toggle extension state: ${error}`);
      return false;
    }
  }

  // Get all available extensions with their enabled status
  async getAllExtensionsWithState() {
    // Find all potential extensions, including disabled ones
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
          LogService.error(`Error loading extension ${id}: ${error}`);
        }
      }

      return allExtensions;
    } catch (error) {
      LogService.error(`Error retrieving all extensions: ${error}`);
      return [];
    }
  }

  async searchAll(query: string): Promise<ExtensionResult[]> {
    if (this.extensions.length === 0) {
      LogService.debug("No extensions loaded, skipping search");
      return [];
    }

    const results: ExtensionResult[] = [];
    const lowercaseQuery = query.toLowerCase();

    LogService.debug(
      `Searching ${this.extensions.length} extensions with query: "${query}"`
    );

    for (let i = 0; i < this.extensions.length; i++) {
      const extension = this.extensions[i];
      const manifest = this.manifests.get(Array.from(this.manifests.keys())[i]);

      if (
        manifest &&
        manifest.commands.some((cmd) => {
          const triggers = cmd.trigger.split("");
          return triggers.some((t) =>
            lowercaseQuery.startsWith(t.toLowerCase())
          );
        })
      ) {
        LogService.debug(`Extension "${manifest.name}" matched query`);
        const extensionResults = await extension.search(query);
        results.push(...extensionResults);
      }
    }

    LogService.debug(`Found ${results.length} extension results`);
    return results;
  }

  async handleViewSearch(query: string): Promise<void> {
    if (this.currentExtension?.onViewSearch) {
      await this.currentExtension.onViewSearch(query);
    }
  }

  navigateToView(viewPath: string) {
    const extensionName = viewPath.split("/")[0];

    // Find the manifest by exact name to avoid partial matches
    const manifest = Array.from(this.manifests.values()).find(
      (m) => m.name.toLowerCase() === extensionName.toLowerCase()
    );

    if (manifest) {
      // Save current query for when we return to main view
      this.savedMainQuery = get(searchQuery);

      // Always clear search when navigating to extension view
      searchQuery.set("");

      // Set current extension and view state
      this.currentExtension =
        this.extensions[
          Array.from(this.manifests.keys()).indexOf(manifest.name)
        ];

      // Update searchable state based on manifest
      activeViewSearchable.set(manifest.searchable ?? false);
      activeView.set(viewPath);

      LogService.debug(
        `Navigating to view: ${viewPath}, searchable: ${manifest.searchable}`
      );
    } else {
      LogService.error(`No manifest found for extension: ${extensionName}`);
    }
  }

  closeView() {
    this.currentExtension = null;
    activeViewSearchable.set(false);

    // Restore main search query when returning to main view
    searchQuery.set(this.savedMainQuery);
    activeView.set(null);
  }

  /**
   * Returns all loaded extensions without filtering
   * @returns All available extensions
   */
  async getAllExtensions() {
    // Gather all searchable items from extensions
    const allItems = [];

    // Add basic extension information for each extension
    for (const [index, extension] of this.extensions.entries()) {
      const manifest = Array.from(this.manifests.values())[index];
      if (manifest) {
        // Add the extension itself as a searchable item
        allItems.push({
          title: manifest.name,
          subtitle: manifest.description,
          keywords: manifest.commands.map((cmd) => cmd.trigger).join(" "),
          type: manifest.type,
          action: () => {
            if (manifest.type === "view") {
              this.navigateToView(`${manifest.name}/index`);
            }
          },
        });
      }

      // Also include items from search providers if available
      if (extension.searchProviders) {
        for (const provider of extension.searchProviders) {
          try {
            const items = await provider.getAll();
            if (items && Array.isArray(items)) {
              allItems.push(...items);
            }
          } catch (error) {
            LogService.error(
              `Error getting items from search provider: ${error}`
            );
          }
        }
      }
    }

    return allItems;
  }

  /**
   * Uninstall an extension completely
   * @param extensionId The ID of the extension to uninstall
   * @returns Success status
   */
  async uninstallExtension(
    extensionId: string,
    extensionName: string
  ): Promise<boolean> {
    try {
      extensionUninstallInProgress.set(extensionId);
      LogService.info(
        `Starting uninstallation of extension: ${extensionId} (${extensionName})`
      );

      // First, disable the extension if it's active
      if (this.manifests.has(extensionName)) {
        LogService.info(
          `Disabling active extension before uninstall: ${extensionName}`
        );
        const disableSuccess = await this.toggleExtensionState(
          extensionName,
          false
        );
        if (!disableSuccess) {
          LogService.error(
            `Failed to disable extension ${extensionName} before uninstall`
          );
          // Continue with uninstall attempt anyway
        }
      }

      // Get extension directory path
      const extensionsDir = await this.getExtensionsDirectory();
      LogService.info(`Extensions base directory: ${extensionsDir}`);

      // Path to the specific extension
      const extensionPath = await join(extensionsDir, extensionId);
      LogService.info(`Full extension path to delete: ${extensionPath}`);

      // Add safety check - prevent deletion if path is too short or suspicious
      // This helps prevent accidental deletion of important directories
      if (extensionPath.length < 10 || !extensionPath.includes("extensions")) {
        LogService.error(
          `Safety check failed: Invalid extension path ${extensionPath}`
        );
        return false;
      }

      // Verify this is an extension directory before attempting deletion
      try {
        // Check for manifest.json existence to confirm it's an extension
        const manifestPath = await join(extensionPath, "manifest.json");
        const manifestExists = await invoke("check_path_exists", {
          path: manifestPath,
        });

        if (!manifestExists) {
          LogService.info(
            `No manifest.json found at ${manifestPath} - this may not be an extension directory`
          );
          // Continue with caution
        }
      } catch (error) {
        // Non-fatal error, continue with deletion anyway
        LogService.info(
          `Error checking extension directory structure: ${error}`
        );
      }

      // Try to delete the extension using Rust side handler first
      try {
        await invoke("delete_extension_directory", { path: extensionPath });
        LogService.info(
          `Successfully deleted extension directory through Rust handler: ${extensionPath}`
        );
      } catch (rustError) {
        LogService.error(`Rust directory deletion failed: ${rustError}`);

        // Fall back to JS-side deletion
        try {
          const pathExists = await invoke("check_path_exists", {
            path: extensionPath,
          });
          if (pathExists) {
            await remove(extensionPath, { recursive: true });
            LogService.info(
              `Successfully deleted extension directory via JS API: ${extensionPath}`
            );
          } else {
            LogService.info(`Extension directory not found: ${extensionPath}`);
          }
        } catch (jsError) {
          LogService.error(`JS-side directory deletion failed: ${jsError}`);
          return false; // Return failure if we couldn't delete the files
        }
      }

      // Remove from extension settings
      await settingsService.removeExtensionState(extensionName);
      LogService.info(`Removed extension settings for: ${extensionName}`);

      // Force a refresh of the extensions list
      await this.loadExtensions();
      LogService.info(`Reloaded extensions after uninstall`);

      return true;
    } catch (error) {
      LogService.error(
        `Failed to uninstall extension ${extensionId}: ${error}`
      );
      return false;
    } finally {
      extensionUninstallInProgress.set(null);
    }
  }

  /**
   * Get the directory where extensions are stored
   * In development, this is the src/extensions directory
   * In production, this is the app data directory
   */
  private async getExtensionsDirectory(): Promise<string> {
    try {
      // Check if we're in development mode
      const isDev = import.meta.env?.DEV === true;
      LogService.debug(
        `Running in ${isDev ? "development" : "production"} mode`
      );

      if (isDev) {
        // In development, use the src/extensions directory
        try {
          // Get the source path relative to the current execution context
          const sourcePath =
            "/Users/khoshbinali/development/asyar/src/extensions";
          LogService.debug(`Using development extensions path: ${sourcePath}`);
          return sourcePath;
        } catch (error) {
          LogService.error(
            `Failed to resolve development extensions path: ${error}`
          );
          throw error;
        }
      } else {
        // In production, use the app data directory
        const appDirectory = await appDataDir();
        const extensionsPath = await join(appDirectory, "extensions");
        LogService.debug(`Using production extensions path: ${extensionsPath}`);
        return extensionsPath;
      }
    } catch (error) {
      LogService.error(`Failed to get extensions directory: ${error}`);

      // Fallback to resource directory
      const resourceDirectory = await resourceDir();
      const fallbackPath = await join(resourceDirectory, "extensions");
      LogService.debug(`Using fallback extensions path: ${fallbackPath}`);
      return fallbackPath;
    }
  }
}

export default new ExtensionManager();
