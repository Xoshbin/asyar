import { logService } from "./logService";
import type { ExtensionManifest } from "asyar-api";

const extensionContext = import.meta.glob("../extensions/*/manifest.json");

// New type to store indexed extension metadata
export interface ExtensionIndex {
  id: string;
  path: string;
  manifest: ExtensionManifest;
  loaded: boolean;
}

export async function discoverExtensions(): Promise<string[]> {
  try {
    // Get all extension paths from Vite's import.meta.glob
    const extensionPaths = Object.keys(extensionContext);

    // Extract extension IDs from paths
    const extensionIds = extensionPaths
      .map((path) => {
        const matches = path.match(/\/extensions\/(.+)\/manifest\.json/);
        return matches ? matches[1] : null;
      })
      .filter((id): id is string => id !== null);

    return extensionIds;
  } catch (err) {
    logService.error("No extensions found or error during discovery");
    return [];
  }
}

// New function to load only extension manifests without the actual extension code
export async function indexExtensions(): Promise<ExtensionIndex[]> {
  try {
    const extensionIds = await discoverExtensions();
    const extensionIndexes: ExtensionIndex[] = [];

    for (const id of extensionIds) {
      try {
        // Only load the manifest file
        const manifest = await import(
          /* @vite-ignore */ `../extensions/${id}/manifest.json`
        );

        // Create index entry
        extensionIndexes.push({
          id,
          path: `../extensions/${id}`,
          manifest,
          loaded: false,
        });

        logService.debug(`Indexed extension: ${manifest.name} (${id})`);
      } catch (error) {
        logService.error(`Failed to index extension ${id}: ${error}`);
      }
    }

    logService.info(`Indexed ${extensionIndexes.length} extensions`);
    return extensionIndexes;
  } catch (error) {
    logService.error(`Failed to index extensions: ${error}`);
    return [];
  }
}
