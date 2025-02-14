import { Plugin, PluginManifest } from "../types/Plugin";
import { info, error } from "@tauri-apps/plugin-log";
import type { AsyarAPI } from "../api";

import {
  clipboard,
  panel,
  applications,
  commands,
  ui,
  system,
  store,
  log,
} from "../api";

// Create API instance
const AsyarAPI: AsyarAPI = {
  clipboard,
  panel,
  applications,
  commands,
  ui,
  system,
  store,
  log,
};

export async function loadPlugin(pluginId: string): Promise<Plugin | null> {
  try {
    info(`[PLUGIN LOADER] Starting to load plugin: ${pluginId}`);

    // First load the manifest
    info(
      `[PLUGIN LOADER] Attempting to load manifest from: ../plugins/${pluginId}/manifest.json`
    );
    let manifest: PluginManifest;
    try {
      const manifestModule = await import(
        `../plugins/${pluginId}/manifest.json`
      );
      manifest = manifestModule.default || manifestModule;
    } catch (manifestErr) {
      error(`[PLUGIN LOADER] Failed to load manifest: ${manifestErr}`);
      throw manifestErr;
    }

    // Then load the plugin module
    info(
      `[PLUGIN LOADER] Attempting to load plugin module from: ../plugins/${pluginId}/plugin`
    );
    try {
      const pluginModule = await import(
        /* @vite-ignore */
        `../plugins/${pluginId}/plugin`
      );

      if (!pluginModule.default) {
        throw new Error("Plugin module must have a default export");
      }

      const plugin: Plugin = pluginModule.default;
      plugin.manifest = manifest;
      plugin.api = AsyarAPI; // Inject API

      // Verify view handler exists if views are declared
      if (manifest.views && manifest.views.length > 0 && !plugin.getView) {
        throw new Error(
          `Plugin ${pluginId} declares views but has no getView handler`
        );
      }

      // Initialize the plugin
      if (plugin.initialize) {
        info(`[PLUGIN LOADER] Initializing plugin ${manifest.name}`);
        await plugin.initialize();
        info(
          `[PLUGIN LOADER] Plugin ${manifest.name} initialized successfully`
        );
      }

      return plugin;
    } catch (moduleErr) {
      error(`[PLUGIN LOADER] Failed to load plugin module: ${moduleErr}`);
      throw moduleErr;
    }
  } catch (err) {
    error(`[PLUGIN LOADER] Critical error loading plugin ${pluginId}:`);
    return null;
  }
}
