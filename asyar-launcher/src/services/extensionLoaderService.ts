import { logService } from './log/logService';
import type { ExtensionManifest } from 'asyar-sdk/contracts';
import { isBuiltInFeature } from './extension/extensionDiscovery';
import {
  discoverExtensions as discoverExtensionsIpc,
  getExtension as getExtensionIpc,
} from '../lib/ipc/commands';
import { resolveRuntime } from '../lib/ipc/runtimeCommands';
import { extensionStateManager } from './extension/extensionStateManager.svelte';

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
    this.isDevMode = import.meta.env.MODE === 'development';
    logService.info(
      `ExtensionLoader initialized in ${this.isDevMode ? 'development' : 'production'} mode`,
    );
  }

  /**
   * Declared runtimes (e.g. a future `ffmpeg`) not yet installed locally.
   * Empty when the manifest declares none, or when every declared runtime
   * already resolves.
   */
  private async getMissingRuntimes(manifest: ExtensionManifest): Promise<string[]> {
    const runtimes = manifest.runtimes ?? [];
    if (runtimes.length === 0) return [];
    const resolved = await Promise.all(runtimes.map((name) => resolveRuntime(name)));
    return runtimes.filter((_, i) => resolved[i] === null);
  }

  /**
   * Whether `record` should be skipped for a still-missing declared
   * runtime. Built-ins are always trusted (bundled with the app, same as
   * the compatibility checks above) and never gated here. Updates
   * `extensionStateManager.needsRuntime` as a side effect either way, so
   * the mark clears again once a previously-missing runtime resolves.
   */
  private async isBlockedByMissingRuntime(record: {
    manifest: ExtensionManifest;
    isBuiltIn: boolean;
  }): Promise<boolean> {
    if (record.isBuiltIn) return false;
    const missingRuntimes = await this.getMissingRuntimes(record.manifest);
    if (missingRuntimes.length > 0) {
      extensionStateManager.markNeedsRuntime(record.manifest.id);
      logService.warn(
        `Skipping extension ${record.manifest.id}: missing runtime(s) ${missingRuntimes.join(', ')}`,
      );
      return true;
    }
    extensionStateManager.clearNeedsRuntime(record.manifest.id);
    return false;
  }

  /**
   * Initializes built-in platform features from static descriptors and Vite-loaded modules.
   * Completely decoupled from dynamic third-party extension discovery.
   */
  loadBuiltInFeatures(records: any[]): Map<string, LoadedExtensionModule> {
    const builtInsMap = new Map<string, LoadedExtensionModule>();
    const builtInFeatureModules = import.meta.glob(
      ['/src/built-in-features/*/index.ts', '/src/built-in-features/*/index.svelte.ts'],
      { eager: true },
    ) as Record<string, any>;

    for (const record of records) {
      if (!record.enabled) {
        logService.debug(`Skipping disabled built-in feature: ${record.manifest.id}`);
        continue;
      }

      const modulePath = Object.keys(builtInFeatureModules).find((p) =>
        p.includes(`/${record.manifest.id}/`),
      );

      builtInsMap.set(record.manifest.id, {
        module: modulePath ? builtInFeatureModules[modulePath] : null,
        manifest: record.manifest,
        isBuiltIn: true,
      });

      if (!modulePath) {
        logService.warn(`Vite module not found for built-in feature ${record.manifest.id}`);
      } else {
        logService.debug(`Loaded built-in feature: ${record.manifest.id}`);
      }
    }
    return builtInsMap;
  }

  /**
   * Discovers and registers installed and dev third-party extensions.
   * Validates SDK compatibility, declared runtimes, and theme-only extensions.
   */
  async loadInstalledExtensions(records: any[]): Promise<Map<string, LoadedExtensionModule>> {
    const installedMap = new Map<string, LoadedExtensionModule>();

    for (const record of records) {
      if (!record.enabled) {
        logService.debug(`Skipping disabled extension: ${record.manifest.id}`);
        continue;
      }

      // Check compatibility
      if (record.compatibility?.status === 'sdkMismatch') {
        logService.warn(
          `Skipping extension ${record.manifest.id}: requires SDK ${record.compatibility.required}, ` +
            `app supports ${record.compatibility.supported}`,
        );
        continue;
      }
      if (record.compatibility?.status === 'appVersionTooOld') {
        logService.warn(
          `Skipping extension ${record.manifest.id}: requires app version ${record.compatibility.required}, ` +
            `current is ${record.compatibility.current}`,
        );
        continue;
      }

      // Skip theme extensions — they have no JS module to load
      if (record.manifest.type === 'theme') {
        continue;
      }

      if (await this.isBlockedByMissingRuntime(record)) {
        continue;
      }

      // Installed/dev extensions execute securely inside their own sandboxed iframes
      installedMap.set(record.manifest.id, {
        module: null,
        manifest: record.manifest,
        isBuiltIn: false,
      });
      logService.debug(`Registered installed extension: ${record.manifest.id} from ${record.path}`);
    }
    return installedMap;
  }

  /**
   * Load all extensions (both built-in platform features and installed third-party extensions).
   */
  async loadAllExtensions(): Promise<Map<string, LoadedExtensionModule>> {
    const extensionsMap = new Map<string, LoadedExtensionModule>();

    try {
      // 1. Get all extension records from Rust
      const records = await discoverExtensionsIpc();
      if (records === null) {
        return extensionsMap;
      }

      // 2. Separate built-in features from installed third-party extensions
      const builtInRecords = records.filter((r) => r.isBuiltIn);
      const installedRecords = records.filter((r) => !r.isBuiltIn);

      // 3. Load built-ins directly
      const builtIns = this.loadBuiltInFeatures(builtInRecords);
      for (const [id, ext] of builtIns) {
        extensionsMap.set(id, ext);
      }

      // 4. Load third-party extensions asynchronously
      const installed = await this.loadInstalledExtensions(installedRecords);
      for (const [id, ext] of installed) {
        extensionsMap.set(id, ext);
      }

      return extensionsMap;
    } catch (error) {
      logService.error(`Error loading extensions: ${error}`);
      return extensionsMap;
    }
  }

  /**
   * Loads a single extension by ID
   */
  async loadSingleExtension(extensionId: string): Promise<LoadedExtensionModule | null> {
    try {
      // 1. Get extension from Rust (checks all sources)
      const record = await getExtensionIpc(extensionId);
      if (record === null) {
        return null;
      }

      if (!record.enabled) {
        logService.warn(`Attempted to load disabled extension: ${extensionId}`);
        return null;
      }

      if (record.isBuiltIn) {
        const builtIns = this.loadBuiltInFeatures([record]);
        return builtIns.get(extensionId) ?? null;
      }

      // Check compatibility for third-party extensions
      if (record.compatibility?.status === 'sdkMismatch') {
        logService.warn(
          `Skipping extension ${record.manifest.id}: requires SDK ${record.compatibility.required}, ` +
            `app supports ${record.compatibility.supported}`,
        );
        return null;
      }
      if (record.compatibility?.status === 'appVersionTooOld') {
        logService.warn(
          `Skipping extension ${record.manifest.id}: requires app version ${record.compatibility.required}, ` +
            `current is ${record.compatibility.current}`,
        );
        return null;
      }

      // Skip theme extensions — they have no JS module to load
      if (record.manifest.type === 'theme') {
        return null;
      }

      if (await this.isBlockedByMissingRuntime(record)) {
        return null;
      }

      return {
        module: null,
        manifest: record.manifest,
        isBuiltIn: false,
      };
    } catch (error) {
      logService.error(`Error in loadSingleExtension for ${extensionId}: ${error}`);
      return null;
    }
  }
}

export const extensionLoaderService = new ExtensionLoaderService();
export default extensionLoaderService;
