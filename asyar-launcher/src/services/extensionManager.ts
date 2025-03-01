import { writable, get } from "svelte/store";
import { searchQuery } from "../stores/search";
import { LogService } from "./logService";
import { discoverExtensions } from "./extensionDiscovery";
import { settingsService } from "./settingsService";
import type {
  Extension,
  ExtensionResult,
  ExtensionManifest,
} from "../types/extension";

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
}

export default new ExtensionManager();
