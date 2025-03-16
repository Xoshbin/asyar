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
} from "asyar-extension-sdk";
import { discoverExtensions } from "./extensionDiscovery";
import { ExtensionBridge } from "asyar-extension-sdk";
import { LogService, logService } from "./logService";
import type { IExtensionDiscovery } from "./interfaces/IExtensionDiscovery";
import { NotificationService } from "./notificationService";
import { ClipboardHistoryService } from "./clipboardHistoryService";
import { actionService } from "./actionService";
import { commandService } from "./commandService";

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
      const extensionIds = await discoverExtensions();
      logService.info(`Discovered extensions: ${extensionIds.join(", ")}`);

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

            enabledCount++;
          } else {
            disabledCount++;
          }
        }
      }

      // Initialize and activate extensions via the bridge
      await this.bridge.initializeExtensions();
      await this.bridge.activateExtensions();

      // Call registerCommands if available on extensions
      for (const extension of this.extensions) {
        if (extension.registerCommands) {
          try {
            await extension.registerCommands();
          } catch (error) {
            logService.error(`Error registering commands: ${error}`);
          }
        }
      }

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

      if (!extension) {
        logService.error(
          `Invalid extension loaded from ${path}: missing default export`
        );
        return [null, null];
      }

      // Validate that the extension properly implements the required interface
      if (typeof extension.registerCommands !== "function") {
        logService.error(
          `Invalid extension loaded from ${path}: missing required registerCommands method`
        );
        return [null, null];
      }

      if (typeof extension.executeCommand !== "function") {
        logService.error(
          `Invalid extension loaded from ${path}: missing required executeCommand method`
        );
        return [null, null];
      }

      logService.info(`Loading extension: ${manifest.id} (${manifest.name})`);

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
   * Search across all extensions
   */
  async searchAll(query: string): Promise<ExtensionResult[]> {
    if (this.extensions.length === 0) {
      return [];
    }

    const results: ExtensionResult[] = [];
    const lowercaseQuery = query.toLowerCase();

    // First check if there's a direct command match
    const commandMatch = this.findCommandMatch(lowercaseQuery);
    if (commandMatch) {
      const [extensionId, commandId, args] = commandMatch;
      try {
        // Find the extension that owns this command
        const extension = this.extensions.find(
          (ext) => this.extensionManifestMap.get(ext)?.id === extensionId
        );

        if (extension && extension.executeCommand) {
          // Get the command definition
          const cmd = this.commandMap.get(`${extensionId}.${commandId}`);

          if (cmd) {
            // Check if this command has a "resultType" of "inline" in the manifest
            const manifest =
              this.manifests.get(extensionId) ||
              Array.from(this.manifests.values()).find(
                (m) => m.id === extensionId
              );

            const commandDef = manifest?.commands.find(
              (c) => c.id === commandId
            );
            const isInlineResult = commandDef?.resultType === "inline";

            if (isInlineResult) {
              // For inline result types, execute the command immediately and display its result
              try {
                const commandResult = await extension.executeCommand(
                  commandId,
                  args
                );

                // Create a result directly from the command's output
                if (commandResult) {
                  // Use a more generic approach without hard-coded extension-specific properties
                  const title =
                    commandResult.displayTitle ||
                    commandResult.formatted ||
                    (commandResult.result !== undefined
                      ? `${commandResult.expression || ""} = ${
                          commandResult.result
                        }`
                      : String(commandResult.title || ""));

                  const subtitle =
                    commandResult.displaySubtitle ||
                    commandResult.description ||
                    cmd.description;

                  results.push({
                    score: 100,
                    title: title,
                    subtitle: subtitle,
                    type: "result",
                    action: () => {
                      // Delegate action handling to the extension itself via executeCommand
                      try {
                        extension.executeCommand(
                          `${commandId}-action`,
                          commandResult
                        );
                        logService.info(
                          `Executed action for command: ${commandId}`
                        );
                      } catch (error) {
                        logService.error(
                          `Error executing action for ${commandId}: ${error}`
                        );
                      }
                    },
                  });
                }
              } catch (error) {
                logService.error(
                  `Error executing inline command ${commandId}: ${error}`
                );
              }
            } else {
              results.push({
                score: 100, // High score for direct command match
                title: `Execute: ${cmd.name}`,
                subtitle: cmd.description,
                type: "result",
                action: async () => {
                  try {
                    await extension.executeCommand(commandId, args);
                  } catch (error) {
                    logService.error(
                      `Error executing command ${commandId}: ${error}`
                    );
                  }
                },
              });
            }
          }
        }
      } catch (error) {
        logService.error(`Error processing command match: ${error}`);
      }
    }

    // Then do the regular search for extensions that match the query
    for (let i = 0; i < this.extensions.length; i++) {
      const extension = this.extensions[i];
      const manifest = this.extensionManifestMap.get(extension);

      if (
        manifest &&
        this.extensionMatchesQuery(manifest, lowercaseQuery) &&
        extension.search
      ) {
        // Only call search if the method exists
        const extensionResults = await extension.search(query);
        results.push(...extensionResults);
      }
    }

    return results;
  }

  /**
   * Find a matching command from the query
   * Returns [extensionId, commandId, args] if found, null otherwise
   */
  private findCommandMatch(query: string): [string, string, any] | null {
    // First, try to find a character-set command that matches
    for (const [fullCommandId, command] of this.commandMap.entries()) {
      const trigger = command.trigger;

      // Check if this might be a character-set trigger (like calculator's math operators)
      if (this.isCharacterSetTrigger(trigger)) {
        // Create a set of allowed characters from the trigger
        const allowedChars = new Set(trigger.split(""));

        // Check if query only contains characters from the trigger
        if ([...query].every((char) => allowedChars.has(char))) {
          // Extract extension and command IDs
          const [extensionId, commandId] = fullCommandId.split(".");
          return [extensionId, commandId, { input: query }];
        }
      }
    }

    // If no character-set match, try standard prefix matching
    for (const [fullCommandId, command] of this.commandMap.entries()) {
      const triggerWord = command.trigger.toLowerCase();

      if (query.toLowerCase().startsWith(triggerWord)) {
        // Extract extension and command IDs
        const [extensionId, commandId] = fullCommandId.split(".");

        // Always extract arguments - this is the key fix!
        const args = query.substring(triggerWord.length).trim();

        logService.debug(`Command match: ${fullCommandId}, Args: "${args}"`);

        return [extensionId, commandId, { input: args }];
      }
    }

    return null;
  }

  /**
   * Determine if a trigger is a character set rather than a simple prefix
   */
  private isCharacterSetTrigger(trigger: string): boolean {
    // Character sets typically:
    // - Contain digits and special characters
    // - Have no spaces
    // - Are relatively long (like "0123456789+-*/()^.")

    if (trigger.includes(" ")) return false;

    // Check for multiple types of characters
    const hasDigits = /\d/.test(trigger);
    const hasSymbols = /[^\w\s]/.test(trigger);

    // If it has both digits and symbols and is at least 5 chars long
    return hasDigits && hasSymbols && trigger.length >= 5;
  }

  /**
   * Check if extension matches the query
   */
  private extensionMatchesQuery(
    manifest: ExtensionManifest,
    query: string
  ): boolean {
    // Include both old trigger matching and new command-based matching
    return manifest.commands.some((cmd) => {
      // For backward compatibility with current trigger format
      const triggers = cmd.trigger.split("");
      return (
        triggers.some((t) => query.startsWith(t.toLowerCase())) ||
        // New format - match command trigger words
        query.startsWith(cmd.trigger.split(" ")[0].toLowerCase())
      );
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

export default new ExtensionManager() as IExtensionManager;
