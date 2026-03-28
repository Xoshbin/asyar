import { logService } from "./log/logService";
import type { ExtensionManifest } from "asyar-sdk";
import { isBuiltInFeature } from "./extension/extensionDiscovery";
import { discoverExtensions as discoverExtensionsIpc, getExtension as getExtensionIpc } from "../lib/ipc/commands";

// Type for extension loading response
export interface LoadedExtensionModule {
  module: any | null; // Store the whole module
  manifest: ExtensionManifest | null;
  isBuiltIn: boolean; // Flag to distinguish built-in extensions
}

class ExtensionLoaderService {
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
  async loadAllExtensions(): Promise<Map<string, LoadedExtensionModule>> {
    const extensionsMap = new Map<string, LoadedExtensionModule>();

    try {
      // 1. Get all extension records from Rust (manifests + state + paths)
      const records = await discoverExtensionsIpc();
      
      // 2. Load built-in JS modules (Vite globs — must stay in TypeScript)
      const builtInFeatureModules = import.meta.glob('/src/built-in-features/*/index.ts', { eager: true }) as Record<string, any>;

      for (const record of records) {
        if (!record.enabled) {
          logService.debug(`Skipping disabled extension: ${record.manifest.id}`);
          continue;
        }

        if (record.isBuiltIn) {
          // Match to Vite-loaded module by ID
          const modulePath = Object.keys(builtInFeatureModules).find(
            p => p.includes(`/${record.manifest.id}/`)
          );
          
          extensionsMap.set(record.manifest.id, {
            module: modulePath ? builtInFeatureModules[modulePath] : null,
            manifest: record.manifest,
            isBuiltIn: true
          });
          
          if (!modulePath) {
            logService.warn(`Vite module not found for built-in feature ${record.manifest.id}`);
          } else {
            logService.debug(`Loaded built-in feature: ${record.manifest.id}`);
          }
        } else {
          // Installed/dev extensions: manifest from Rust, no module (iframe)
          extensionsMap.set(record.manifest.id, {
            module: null,
            manifest: record.manifest,
            isBuiltIn: false
          });
          logService.debug(`Registered installed extension: ${record.manifest.id} from ${record.path}`);
        }
      }

      return extensionsMap;
    } catch (error) {
      logService.error(`Error loading extensions: ${error}`);
      return extensionsMap; // Return whatever was loaded successfully
    }
  }

  /**
   * Loads a single extension by ID
   */
  async loadSingleExtension(
    extensionId: string
  ): Promise<LoadedExtensionModule | null> {
    try {
      // 1. Get extension from Rust (checks all sources)
      const record = await getExtensionIpc(extensionId);
      
      if (!record.enabled) {
        logService.warn(`Attempted to load disabled extension: ${extensionId}`);
        return null;
      }

      if (record.isBuiltIn) {
        // Find Vite module
        const builtInFeatureModules = import.meta.glob('/src/built-in-features/*/index.ts', { eager: true }) as Record<string, any>;
        const modulePath = Object.keys(builtInFeatureModules).find(
          p => p.includes(`/${extensionId}/`)
        );

        if (!modulePath) {
          logService.error(`Module not found for built-in feature ${extensionId}`);
          return null;
        }

        return {
          module: builtInFeatureModules[modulePath],
          manifest: record.manifest,
          isBuiltIn: true
        };
      } else {
        // [ARCHITECTURE SAFEGUARD]: CODE LOADING SEPARATION
        // Tier 1 (Built-in) extensions have their JS modules dynamically imported 
        // into the privileged Host window context to execute.
        // Tier 2 (Installed) extensions MUST NEVER be imported into the Host window.
        // They execute securely inside their own sandboxed iframes. By returning
        // `module: null` here, we guarantee their code cannot execute in the Host.
        // The iframe handles fetching and executing their `index.html` and scripts.
        return {
          module: null,
          manifest: record.manifest,
          isBuiltIn: false
        };
      }
    } catch (error) {
      logService.error(`Error in loadSingleExtension for ${extensionId}: ${error}`);
      return null;
    }
  }
}

export const extensionLoaderService = new ExtensionLoaderService();
export default extensionLoaderService;
