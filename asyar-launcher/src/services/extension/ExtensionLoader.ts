import { ExtensionBridge } from "asyar-sdk";
import type { Extension, ExtensionManifest, ExtensionCommand } from "asyar-sdk";
import { logService } from "../log/logService";
import { extensionLoaderService } from "../extensionLoaderService";
import { settingsService } from "../settings/settingsService";
import { performanceService } from "../performance/performanceService";
import { envService } from "../envService";
import { commandService } from "./commandService";
import * as commands from "../../lib/ipc/commands";

// Local extension of the manifest type (same as in extensionManager.ts)
interface ExtendedManifest extends ExtensionManifest {
  permissions?: string[];
  main?: string;
}

/**
 * A loaded extension module: either a direct Extension instance
 * or an ES module wrapper where the extension is the default export.
 */
type LoadedExtensionModule = Extension | { default: Extension };

export class ExtensionLoader {
  // Internal state built during loadExtensions()
  private extensionModulesById = new Map<string, LoadedExtensionModule>();
  private allLoadedCommands: { cmd: ExtensionCommand; manifest: ExtensionManifest; isBuiltIn: boolean }[] = [];

  constructor(
    private readonly bridge: ExtensionBridge,
    private readonly onManifestRegistered: (id: string, manifest: ExtendedManifest) => void,
    private readonly onModuleRegistered: (id: string, module: LoadedExtensionModule) => void,
    private readonly onCommandRegistered: (cmd: ExtensionCommand, manifest: ExtensionManifest, isBuiltIn: boolean) => void,
  ) {}

  private resolveExtensionInstance(module: LoadedExtensionModule): Extension {
    if (module && 'default' in module && module.default != null) {
      return module.default;
    }
    return module as Extension;
  }

  private getCmdObjectId(cmd: ExtensionCommand, manifest: ExtensionManifest): string {
    const commandId = cmd.id || "unknown_cmd";
    const extensionId = manifest.id || "unknown_ext";
    return `cmd_${extensionId}_${commandId}`;
  }

  async loadExtensions(
    navigateToView: (viewPath: string) => void,
    isReady: { set: (value: boolean) => void },
  ): Promise<void> {
    logService.debug(
      "Starting loadExtensions process using extensionLoaderService..."
    );
    try {
      // Clear its own internal state at the start
      this.extensionModulesById.clear();
      this.allLoadedCommands = [];

      // Use the loader service
      const loadedExtensionsMap =
        await extensionLoaderService.loadAllExtensions();

      let enabledCount = 0;
      let disabledCount = 0;

      // Process the loaded extensions provided by the service
      for (const [
        loaderId,
        { module, manifest, isBuiltIn },
      ] of loadedExtensionsMap.entries()) {

        // Ensure manifest is not null before proceeding
        if (!manifest || !manifest.id) {
            logService.warn(`Skipping extension loader ID ${loaderId} due to missing manifest or manifest ID.`);
            continue;
        }

        const extensionId = manifest.id;

        // Extension is loaded and enabled (filtered by service), proceed with registration
        performanceService.trackExtensionLoadStart(extensionId); 
        // Store the full module by ID
        this.extensionModulesById.set(extensionId, module);
        this.onModuleRegistered(extensionId, module);
        this.onManifestRegistered(extensionId, manifest as ExtendedManifest); 

        // Register manifest with bridge first
        this.bridge.registerManifest(manifest);

        // Sync declared permissions to the Rust registry for defense-in-depth enforcement.
        if (envService.isTauri) {
          commands.registerExtensionPermissions(
            extensionId,
            (manifest as ExtendedManifest).permissions ?? [],
          ).catch((err: unknown) => {
            logService.warn(`[PermissionRegistry] Failed to register ${extensionId}: ${err}`);
          });
        }

        if (isBuiltIn) {
          // Register with bridge using the default export (class instance)
          if (!module) {
            logService.error(`Module for built-in feature ${extensionId} is invalid.`);
            continue;
          }
          const extensionInstance = this.resolveExtensionInstance(module);
          if (!extensionInstance) {
            logService.error(`Module for built-in feature ${extensionId} does not have a default export or is invalid.`);
            continue; // Skip registration if instance cannot be obtained
          }
          this.bridge.registerExtensionImplementation(extensionId, extensionInstance);
        } else {
          logService.debug(`Registered installed extension: ${extensionId} (Iframe Sandbox)`);
        }

        // Collect commands (manifest is guaranteed non-null here)
        if (manifest.commands) {
          manifest.commands.forEach((cmd) => {
              if (cmd && cmd.id) {
                // Ensure command and its ID exist
                this.onCommandRegistered(cmd, manifest, isBuiltIn);
                this.allLoadedCommands.push({ cmd, manifest, isBuiltIn });
              } else {
              logService.warn(
                `Skipping command due to missing ID in manifest: ${manifest.id}`
              );
            }
          });
        }
        performanceService.trackExtensionLoadEnd(manifest.id);
        enabledCount++;
      }

      // Initialize and activate extensions via the bridge *after* processing all loaded ones
      if (enabledCount > 0) {
        performanceService.startTiming("extension-initialization-activation");
        await this.bridge.initializeExtensions();
        await this.bridge.activateExtensions();
        performanceService.stopTiming("extension-initialization-activation");
        this.registerCommandHandlersFromManifests(navigateToView); // Register handlers only after activation

      } else {
        logService.debug("No enabled extensions to initialize or activate.");
      }

      logService.debug(
        `Extensions loading complete: ${enabledCount} enabled, ${disabledCount} disabled`
      );
      isReady.set(true); // Signal readiness after processing and activation
      logService.debug('[ExtensionManager] Ready.');
    } catch (error) {
      logService.error(`Failed during loadExtensions processing: ${error}`);
      // Clear state on error
      this.extensionModulesById.clear();
      this.allLoadedCommands = [];
    }
  }

  registerCommandHandlersFromManifests(navigateToView: (viewPath: string) => void): void {
    logService.debug(
      `Registering command handlers for ${this.allLoadedCommands.length} loaded commands.`
    );
    this.allLoadedCommands.forEach(({ cmd, manifest, isBuiltIn }) => {
      try {
        const module = this.extensionModulesById.get(manifest.id);

        // Only require the module instance for built-in extensions
        if (isBuiltIn && !module) {
          logService.warn(
            `Could not find loaded feature module for built-in ID: ${manifest.id} while registering command: ${cmd.id}`
          );
          return; // Skip if built-in feature instance not found
        }

        // Ensure cmd and manifest IDs exist
        if (!cmd.id || !manifest.id) {
          logService.warn(
            `Skipping command registration due to missing ID in cmd or manifest.`
          );
          return;
        }

        const fullObjectId = this.getCmdObjectId(cmd, manifest);
        const shortCmdId = cmd.id;

        if (!module) {
          // Tier 2 extensions (iframes) might not have a module instance
          if (!isBuiltIn) {
             const handler = {
              execute: async (args?: Record<string, any>) => {
                const viewName = (cmd as any).view || manifest.defaultView || 'DefaultView';
                navigateToView(`${manifest.id}/${viewName}`);
              },
            };
            commandService.registerCommand(fullObjectId, handler, manifest.id);
            return;
          }
          return;
        }
        
        const extensionInstance = this.resolveExtensionInstance(module);
        
        if (isBuiltIn) {
          if (!extensionInstance || typeof extensionInstance.executeCommand !== 'function') {
             logService.error(`Invalid instance or missing executeCommand for built-in feature ${manifest.id}.`);
             return; 
          }
        }

        const handler = {
          execute: async (args?: Record<string, any>) => {
            try {
              if (isBuiltIn) {
                return await extensionInstance.executeCommand(shortCmdId, args);
              } else {
                const viewName = (cmd as any).view || manifest.defaultView || 'DefaultView';
                navigateToView(`${manifest.id}/${viewName}`);
              }
            } catch (execError) {
              logService.error(
                `Error executing command ${shortCmdId} in extension ${manifest.id}: ${execError}`
              );
              throw execError;
            }
          },
        };
        commandService.registerCommand(fullObjectId, handler, manifest.id);

        logService.debug(
          `Registered handler for command: ${shortCmdId} (ID: ${fullObjectId}) for extension: ${manifest.id}`
        );
      } catch (error) {
        logService.error(
          `Error registering handler for command ${
            cmd?.id || "unknown"
          } of extension ${manifest?.id || "unknown"}: ${error}`
        );
      }
    });
    logService.info(
      `Finished registering command handlers for enabled extensions.`
    );
  }

  async syncCommandIndex(
    allLoadedCommands: { cmd: ExtensionCommand; manifest: ExtensionManifest; isBuiltIn: boolean }[],
  ): Promise<void> {
    logService.info("Starting command index synchronization via Rust...");
    try {
      const inputs: commands.CommandSyncInput[] = allLoadedCommands
        .filter((c) => c.manifest?.id && c.cmd?.id)
        .map(({ cmd, manifest }) => ({
          id: this.getCmdObjectId(cmd, manifest),
          name: cmd.name,
          extension: manifest.id,
          trigger: cmd.trigger || cmd.name,
          type: cmd.resultType || manifest.type,
          icon: cmd.icon ?? manifest.icon ?? null,
        }));

      const result = await commands.syncCommandIndex(inputs);
      logService.info(
        `Command Sync complete: ${result.added} added, ${result.removed} removed, ${result.total} total commands indexed.`
      );
    } catch (error) {
      logService.error(`Failed to synchronize command index: ${error}`);
      throw error;
    }
  }
}
