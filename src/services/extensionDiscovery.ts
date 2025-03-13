import { logService } from "./logService";

const extensionContext = import.meta.glob("../extensions/*/manifest.json");

export async function discoverExtensions(): Promise<string[]> {
  try {
    // LogService.error("Starting extension discovery process...");

    // Get all extension paths from Vite's import.meta.glob
    const extensionPaths = Object.keys(extensionContext);

    // Extract extension IDs from paths
    const extensionIds = extensionPaths
      .map((path) => {
        const matches = path.match(/\/extensions\/(.+)\/manifest\.json/);
        return matches ? matches[1] : null;
      })
      .filter((id): id is string => id !== null);

    // LogService.info(`Discovered ${extensionIds.length} extensions:`);
    return extensionIds;
  } catch (err) {
    logService.error("No extensions found or error during discovery");
    return [];
  }
}
