import { logService } from "./log/logService";
import { exists, readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { join, appDataDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import type { Extension, ExtensionManifest } from "asyar-api";
import {
  isBuiltInExtension,
  getExtensionPath,
} from "./extension/extensionDiscovery";

// Type for extension loading response
export interface LoadedExtension {
  extension: Extension | null;
  manifest: ExtensionManifest | null;
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
  async loadAllExtensions(): Promise<Map<string, LoadedExtension>> {
    const extensionsMap = new Map<string, LoadedExtension>();

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

  /**
   * Loads built-in extensions that are part of the application bundle
   */
  private async loadBuiltInExtensions(
    extensionsMap: Map<string, LoadedExtension>
  ): Promise<void> {
    let builtInDir = "";
    try {
      // Get the base path from Rust command
      builtInDir = await invoke<string>("get_builtin_extensions_path");
      logService.debug(`Loading built-in extensions from: ${builtInDir}`);

      // Check if the directory exists
      if (!(await exists(builtInDir))) {
        logService.warn(`Built-in extensions directory not found: ${builtInDir}`);
        return;
      }

      const entries = await readDir(builtInDir);

      for (const entry of entries) {
        if (entry.isDirectory) { // Check if it's a directory using the isDirectory property
          const id = entry.name; // Use directory name as ID
          if (!id) continue; // Skip if name is missing

          // Skip if already loaded (e.g., installed version takes precedence if loaded first)
          if (extensionsMap.has(id)) {
             logService.debug(`Skipping built-in ${id}, already loaded.`);
             continue;
          }

          const manifestPath = await join(entry.path, "manifest.json");
          const expectedJsPathRelative = `/${entry.name}/index.js`; // Adjust if your build output differs

          try {
            // Load manifest using FS plugin
            if (!(await exists(manifestPath))) {
              logService.warn(`Manifest not found for built-in extension ${id} at ${manifestPath}`);
              continue;
            }
            const manifestContent = await readTextFile(manifestPath);
            const manifest = JSON.parse(manifestContent) as ExtensionManifest;

            // Load JS module using dynamic import (relative to web root)
            // IMPORTANT: This path assumes your build process places built-in extensions
            // at the root level accessible via /<extension-id>/index.js. Adjust as needed.
            const modulePath = `/built-in-extensions${expectedJsPathRelative}`;
            logService.debug(`Attempting to import built-in module: ${modulePath}`);
            const module = await import(/* @vite-ignore */ modulePath);
            const actualExtension = module?.default || module;

            extensionsMap.set(id, {
              extension: actualExtension,
              manifest: manifest,
            });
            logService.debug(`Loaded built-in extension: ${id} (${manifest?.name || "Unknown"})`);

          } catch (error) {
            logService.error(`Failed to load built-in extension ${id} from ${entry.path}: ${error}`);
          }
        }
      }
    } catch (error) {
      logService.error(`Error loading built-in extensions from ${builtInDir}: ${error}`);
    }
  }

  /**
   * Loads user-installed extensions from the app's data directory
   */
  private async loadInstalledExtensions(
    extensionsMap: Map<string, LoadedExtension>
  ): Promise<void> {
    let extensionsDir = "";
    try {
      // Get the base directory for user-installed extensions
      extensionsDir = await invoke<string>("get_extensions_dir");
      logService.debug(`Loading installed extensions from: ${extensionsDir}`);

      if (!(await exists(extensionsDir))) {
        logService.debug(`Installed extensions directory does not exist: ${extensionsDir}`);
        return; // No directory, nothing to load
      }

      const entries = await readDir(extensionsDir);

      for (const entry of entries) {
         if (entry.isDirectory && entry.name) { // Ensure it's a directory with a name
            const extensionId = entry.name;
            const extensionPath = entry.path;

            // Skip if already loaded (built-in takes precedence)
            if (extensionsMap.has(extensionId)) {
              logService.warn(
                `Skipping installed extension ${extensionId}, ID conflicts with already loaded extension.`
              );
              continue;
            }

            let objectURL: string | null = null; // For Blob URL cleanup

            try {
                const manifestPath = await join(extensionPath, "manifest.json");

                if (!(await exists(manifestPath))) {
                    logService.warn(`Manifest not found for installed extension ${extensionId} at ${manifestPath}`);
                    continue;
                }

                // Load manifest
                const manifestContent = await readTextFile(manifestPath);
                const manifest = JSON.parse(manifestContent) as ExtensionManifest;

                // Determine main JS file path from manifest
                const mainJsFile = manifest.main || "index.js"; // Default to index.js
                const jsPath = await join(extensionPath, mainJsFile);

                if (!(await exists(jsPath))) {
                    logService.warn(`Main JS file (${mainJsFile}) not found for installed extension ${extensionId} at ${jsPath}`);
                    continue;
                }

                // Load JS content
                const jsContent = await readTextFile(jsPath);

                // --- Dynamic Import via Blob URL ---
                // SECURITY WARNING: Loading arbitrary code from the filesystem like this
                // is inherently risky. Extensions could contain malicious code.
                // Consider sandboxing or alternative loading mechanisms for better security.
                logService.warn(`SECURITY: Loading installed extension code for '${extensionId}' via Blob URL. Ensure extensions are from trusted sources.`);

                const blob = new Blob([jsContent], { type: 'application/javascript' });
                objectURL = URL.createObjectURL(blob);

                const module = await import(/* @vite-ignore */ objectURL);
                const actualExtension = module?.default || module;
                // --- End Dynamic Import ---

                extensionsMap.set(extensionId, {
                    extension: actualExtension,
                    manifest: manifest,
                });
                logService.debug(`Loaded installed extension: ${extensionId} (${manifest?.name || "Unknown"})`);

            } catch (error) {
                logService.error(`Failed to load installed extension ${extensionId} from ${extensionPath}: ${error}`);
            } finally {
                // --- Crucial Cleanup ---
                if (objectURL) {
                    URL.revokeObjectURL(objectURL);
                    logService.debug(`Revoked Object URL for ${extensionId}`);
                }
            }
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
  ): Promise<LoadedExtension | null> {
    try {
      if (isBuiltInExtension(extensionId)) {
        // For built-in extensions, use a similar approach as in loadBuiltInExtensions
        // but return just the one extension
        let extension: any;
        let manifestData: any;

        try {
          if (this.isDevMode) {
            const basePath = getExtensionPath(extensionId);
            manifestData = await import(
              /* @vite-ignore */ `${basePath}/manifest.json`
            );
            extension = await import(/* @vite-ignore */ `${basePath}/index.ts`);
          } else {
            // Production mode for built-in extensions
            const builtInDir = await invoke<string>("get_builtin_extensions_path");
            const manifestPath = await join(builtInDir, extensionId, "manifest.json");

            if (!(await exists(manifestPath))) {
              throw new Error(`Manifest not found for built-in extension ${extensionId} at ${manifestPath}`);
            }
            const manifestContent = await readTextFile(manifestPath);
            manifestData = JSON.parse(manifestContent); // Assign to manifestData

            // IMPORTANT: Adjust path if your build output differs
            const modulePath = `/built-in-extensions/${extensionId}/index.js`;
            logService.debug(`Attempting to import single built-in module: ${modulePath}`);
            extension = await import(/* @vite-ignore */ modulePath); // Assign to extension
          }

          const actualExtension = extension?.default || extension;
          const actualManifest = manifestData?.default || manifestData;

          return {
            extension: actualExtension,
            manifest: actualManifest,
          };
        } catch (error) {
          logService.error(
            `Failed to load built-in extension ${extensionId}: ${error}`
          );
          return null;
        }
      } else {
        // For installed extensions
        try {
          const extensionsDir = await invoke<string>("get_extensions_dir"); // Add type annotation
          const extensionPath = await join(extensionsDir, extensionId);

          // Check if extension directory exists
          const pathExists = await exists(extensionPath);
          if (!pathExists) {
            logService.warn(`Extension directory not found: ${extensionPath}`);
            return null;
          }

          // This is where you would implement loading from the filesystem
          // Returning null for now as this would require actual implementation
          logService.debug(`Would load single extension from ${extensionPath}`);
          return null;
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
