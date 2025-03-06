import { LogService } from "./logService";

// Use Vite's import.meta.glob to discover extensions
const extensionContext = import.meta.glob("../extensions/*/manifest.json");

/**
 * Discover all available extensions in the project
 */
export async function discoverExtensions(): Promise<string[]> {
  try {
    // Extract extension IDs from paths
    const extensionIds = Object.keys(extensionContext)
      .map((path) => {
        const matches = path.match(/\/extensions\/(.+)\/manifest\.json/);
        return matches ? matches[1] : null;
      })
      .filter((id): id is string => id !== null);

    return extensionIds;
  } catch (error) {
    LogService.error(`Error during extension discovery: ${error}`);
    return [];
  }
}
