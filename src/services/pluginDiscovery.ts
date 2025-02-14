import { info } from "@tauri-apps/plugin-log";

const pluginContext = import.meta.glob("../plugins/*/manifest.json");

export async function discoverPlugins(): Promise<string[]> {
  try {
    info("Starting plugin discovery process...");

    // Get all plugin paths from Vite's import.meta.glob
    const pluginPaths = Object.keys(pluginContext);

    // Extract plugin IDs from paths
    const pluginIds = pluginPaths
      .map((path) => {
        const matches = path.match(/\/plugins\/(.+)\/manifest\.json/);
        return matches ? matches[1] : null;
      })
      .filter((id): id is string => id !== null);

    info(`Discovered ${pluginIds.length} plugins:`);
    return pluginIds;
  } catch (err) {
    info("No plugins found or error during discovery");
    return [];
  }
}
