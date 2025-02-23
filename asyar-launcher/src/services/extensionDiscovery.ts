import { info } from "@tauri-apps/plugin-log";

const extensionContext = import.meta.glob("../extensions/*/manifest.json");

export async function discoverExtensions(): Promise<string[]> {
  try {
    info("Starting extension discovery process...");

    // Get all extension paths from Vite's import.meta.glob
    const extensionPaths = Object.keys(extensionContext);

    // Extract extension IDs from paths
    const extensionIds = extensionPaths
      .map((path) => {
        const matches = path.match(/\/extensions\/(.+)\/manifest\.json/);
        return matches ? matches[1] : null;
      })
      .filter((id): id is string => id !== null);

    info(`Discovered ${extensionIds.length} extensions:`);
    return extensionIds;
  } catch (err) {
    info("No extensions found or error during discovery");
    return [];
  }
}
