import { LogService } from "./logService";
import type { IExtensionDiscovery } from "../interfaces/services/IExtensionDiscovery";

// Use Vite's import.meta.glob to discover extensions
const extensionContext = import.meta.glob("../extensions/*/manifest.json");

/**
 * Service for discovering extensions
 */
class ExtensionDiscovery implements IExtensionDiscovery {
  /**
   * Discover all available extensions in the project
   */
  async discoverExtensions(): Promise<string[]> {
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
}

// Create instance
const extensionDiscovery = new ExtensionDiscovery();

// Export singleton instance
export const { discoverExtensions } = extensionDiscovery;

// Export class for direct usage if needed
export default extensionDiscovery;
