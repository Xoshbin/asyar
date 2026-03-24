import { logService } from "./log/logService";
import { exists, readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { join, appDataDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import type { Extension, ExtensionManifest } from "asyar-sdk";
import * as svelte from 'svelte';
import * as svelteStore from 'svelte/store';
import {
  isBuiltInExtension,
  getExtensionPath,
  discoverExtensions,
  builtInExtensionContext,
} from "./extension/extensionDiscovery";
import { envService } from "./envService";

// Type for extension loading response
export interface LoadedExtensionModule { // Renamed interface
  module: any | null; // Store the whole module
  manifest: ExtensionManifest | null;
  isBuiltIn: boolean; // Added flag to distinguish built-in extensions
}

class ExtensionLoaderService {
  private initialized = false;
  private isDevMode = false;

  constructor() {
    // Determine if we're in development mode
    this.isDevMode = import.meta.env.MODE === "development";
    logService.info(
      `ExtensionLoader initialized in ${
        this.isDevMode ? "development" : "production"
      } mode`
    );
  }

  /**
   * Load all extensions (both built-in and installed)
   */
  async loadAllExtensions(): Promise<Map<string, LoadedExtensionModule>> { // Updated return type
    const extensionsMap = new Map<string, LoadedExtensionModule>(); // Updated map type

    try {
      // Load built-in extensions (should work in both dev and prod)
      await this.loadBuiltInExtensions(extensionsMap);

      // Load installed extensions (from filesystem)
      await this.loadInstalledExtensions(extensionsMap);

      return extensionsMap;
    } catch (error) {
      logService.error(`Error loading extensions: ${error}`);
      return extensionsMap; // Return whatever was loaded successfully
    }
  }

  private async loadBuiltInExtensions(
    extensionsMap: Map<string, LoadedExtensionModule>
  ): Promise<void> {
    try {
      logService.debug("Loading built-in extensions via Vite glob");
      
      const builtInModules = import.meta.glob('/src/built-in-extensions/*/index.ts', { eager: true }) as Record<string, any>;
      const builtInManifests = import.meta.glob('/src/built-in-extensions/*/manifest.json', { eager: true }) as Record<string, any>;

      for (const [path, module] of Object.entries(builtInModules)) {
        const id = path.split('/')[3]; // extracts 'clipboard-history' from '/src/built-in-extensions/clipboard-history/index.ts'
        
        if (extensionsMap.has(id)) {
           logService.debug(`Skipping built-in ${id}, already loaded.`);
           continue;
        }

        const manifestPath = `/src/built-in-extensions/${id}/manifest.json`;
        const manifestModule = builtInManifests[manifestPath];
        const manifest = manifestModule?.default || manifestModule;

        if (!manifest) {
          logService.warn(`No manifest found for built-in extension ${id} at ${manifestPath}`);
          continue;
        }

        // Validate command view names
        if (manifest.commands) {
          if (manifest.defaultView && manifest.defaultView !== 'DefaultView') {
            logService.warn(`Extension ${manifest.id} uses non-standard defaultView: ${manifest.defaultView}. Usage of 'DefaultView' is recommended.`);
          }
          manifest.commands.forEach((cmd: any) => {
            if (cmd.view && cmd.view !== 'DefaultView') {
              logService.warn(`Command ${cmd.id} in extension ${manifest.id} uses non-standard view name: ${cmd.view}. Usage of 'DefaultView' is recommended.`);
            }
          });
        }

        extensionsMap.set(id, {
          module,
          manifest,
          isBuiltIn: true
        });
        logService.debug(`Loaded built-in extension: ${id} (${manifest?.name || "Unknown"})`);
      }
    } catch (error) {
      logService.error(`Error loading built-in extensions: ${error}`);
    }
  }

  /**
   * Loads user-installed extensions from the app's data directory
   */
  private async loadInstalledExtensions(
    extensionsMap: Map<string, LoadedExtensionModule> // Updated map type
  ): Promise<void> {
    let extensionsDir = "";
    let installedEntries: any[] = [];
    try {
      // Get the base directory for user-installed extensions
      extensionsDir = await invoke<string>("get_extensions_dir");
      logService.debug(`Loading installed extensions from: ${extensionsDir}`);

      if (!(await invoke<boolean>("check_path_exists", { path: extensionsDir }))) {
        logService.debug(`Installed extensions directory does not exist: ${extensionsDir}`);
      } else {
        installedEntries = await readDir(extensionsDir);
      }
      
      // Load mapping of dev extensions to their dev paths
      let devExtensions: Record<string, string> = {};
      try {
        devExtensions = await invoke<Record<string, string>>("get_dev_extension_paths");
      } catch (e) {
        logService.warn(`Failed to fetch dev extensions registry: ${e}`);
      }

      // Combine both dev extension entries and installed extension entries into a unified list
      // We process dev extensions first so they take precedence over installed ones in extensionsDir
      const allPathsToLoad: { id: string, path: string }[] = [];
      
      for (const [id, devPath] of Object.entries(devExtensions)) {
         allPathsToLoad.push({ id, path: devPath });
      }

      for (const entry of installedEntries) {
         if ((entry.isDirectory || entry.isSymlink) && entry.name) {
             const extensionPath = await join(extensionsDir, entry.name);
             allPathsToLoad.push({ id: entry.name, path: extensionPath });
         }
      }

      for (const { id: extensionId, path: extensionPath } of allPathsToLoad) {
            // Skip if already loaded (built-in takes precedence)
            if (extensionsMap.has(extensionId)) {
              continue;
            }

            let objectURL: string | null = null; // For Blob URL cleanup

            try {
                const manifestPath = await join(extensionPath, "manifest.json");
                const manifestExists = await invoke<boolean>("check_path_exists", { path: manifestPath });

                if (!manifestExists) {
                    logService.warn(`Manifest not found for installed extension ${extensionId} at ${manifestPath}`);
                    continue;
                }

                // Load manifest
                const manifestContent = await invoke<string>("read_text_file_absolute", { pathStr: manifestPath });
                const manifest = JSON.parse(manifestContent) as ExtensionManifest;

                // Validate command view names
                if (manifest.commands) {
                  manifest.commands.forEach((cmd: any) => {
                    if (cmd.view && cmd.view !== 'DefaultView') {
                      logService.warn(`Warning: extension ${extensionId} command ${cmd.id} declares view '${cmd.view}' — expected 'DefaultView'. Extension may fail to render.`);
                    }
                  });
                }

                // --- No JS Loading for Installed Extensions ---
                // Installed extensions run in an isolated iframe context and are loaded on-demand.
                // We only need to store the manifest to register their commands.

                // Store the parsed manifest (module is null for iframe extensions)
                extensionsMap.set(extensionId, {
                    module: null, 
                    manifest: manifest,
                    isBuiltIn: false // User-installed extension
                });
                logService.debug(`Registered installed extension manifest: ${extensionId} (${manifest?.name || "Unknown"})`);

            } catch (error) {
                // Use constructed full path in error message
                logService.error(`Failed to load installed extension ${extensionId} from ${extensionPath}: ${error}`);
            }
      }
    } catch (error) {
      logService.error(`Error reading installed extensions directory ${extensionsDir}: ${error}`);
    }
  }

  /**
   * Loads a single extension by ID
   */
  async loadSingleExtension(
    extensionId: string
  ): Promise<LoadedExtensionModule | null> { // Updated return type
    try {
      if (isBuiltInExtension(extensionId)) {
        try {
          const builtInModules = import.meta.glob('/src/built-in-extensions/*/index.ts', { eager: true }) as Record<string, any>;
          const builtInManifests = import.meta.glob('/src/built-in-extensions/*/manifest.json', { eager: true }) as Record<string, any>;
            
          const modulePath = `/src/built-in-extensions/${extensionId}/index.ts`;
          const manifestPath = `/src/built-in-extensions/${extensionId}/manifest.json`;

          const module = builtInModules[modulePath];
          const manifestModule = builtInManifests[manifestPath];
          const manifest = manifestModule?.default || manifestModule;

          if (!module || !manifest) {
            throw new Error(`Module or manifest not found for built-in extension ${extensionId} in glob paths.`);
          }

          return {
            module,
            manifest,
            isBuiltIn: true
          };
        } catch (error) {
          logService.error(`Failed to load built-in extension ${extensionId}: ${error}`);
          return null;
        }
      } else {
        // For installed extensions
        try {
          let extensionPath = "";
          try {
             const devExtensions = await invoke<Record<string, string>>("get_dev_extension_paths");
             if (devExtensions[extensionId]) {
                 const devPath = devExtensions[extensionId];
                 if (await invoke<boolean>("check_path_exists", { path: devPath })) {
                     extensionPath = devPath;
                 }
             }
          } catch (e) {
             logService.warn(`Failed to fetch dev extensions registry: ${e}`);
          }
          
          if (!extensionPath) {
              const extensionsDir = await invoke<string>("get_extensions_dir");
              extensionPath = await join(extensionsDir, extensionId);
          }

          // Load manifest
          const manifestPath = await join(extensionPath, "manifest.json");
          const manifestExists = await invoke<boolean>("check_path_exists", { path: manifestPath });
          if (!manifestExists) {
            logService.warn(`Manifest not found for installed extension ${extensionId} at ${manifestPath}`);
            return null;
          }
          const manifestContent = await invoke<string>("read_text_file_absolute", { pathStr: manifestPath });
          const manifest = JSON.parse(manifestContent) as ExtensionManifest;

          // [ARCHITECTURE SAFEGUARD]: CODE LOADING SEPARATION
          // Tier 1 (Built-in) extensions have their JS modules dynamically imported 
          // into the privileged Host window context to execute.
          // Tier 2 (Installed) extensions MUST NEVER be imported into the Host window.
          // They execute securely inside their own sandboxed iframes. By returning
          // `module: null` here, we guarantee their code cannot execute in the Host.
          // The iframe handles fetching and executing their `index.html` and scripts.
          return {
            module: null,
            manifest: manifest,
            isBuiltIn: false
          };
        } catch (error) {
          logService.error(
            `Error loading single extension ${extensionId}: ${error}`
          );
          return null;
        }
      }
    } catch (error) {
      logService.error(
        `Error in loadSingleExtension for ${extensionId}: ${error}`
      );
      return null;
    }
  }
}

export const extensionLoaderService = new ExtensionLoaderService();
export default extensionLoaderService;
