import { logService } from "../log/logService";
import type { ExtensionManifest } from "asyar-sdk/contracts";

// Import both regular and built-in features
export const extensionContext = import.meta.glob("../../extensions/*/manifest.json");
export const builtInFeatureContext = import.meta.glob(
  "../../built-in-features/*/manifest.json"
);


export async function discoverExtensions(): Promise<string[]> {
  try {
    // Get all extension paths from both directories
    const extensionPaths = Object.keys(extensionContext);
    const builtInFeaturePaths = Object.keys(builtInFeatureContext);

    // Log the discovered paths for debugging
    logService.debug(
      `Found ${extensionPaths.length} regular extensions and ${builtInFeaturePaths.length} built-in features`
    );

    // Extract just the extension IDs (names) from the paths
    const regularExtensionIds = extensionPaths
      .map((path) => {
        const matches = path.match(/\/extensions\/([^\/]+)\/manifest\.json/);
        return matches ? matches[1] : null;
      })
      .filter((id) => id !== null);

    const builtInFeatureIds = builtInFeaturePaths
      .map((path) => {
        const matches = path.match(
          /\/built-in-features\/([^\/]+)\/manifest\.json/
        );
        return matches ? matches[1] : null;
      })
      .filter((id) => id !== null);

    // Combine and return just the ids
    const allExtensionIds = [
      ...regularExtensionIds,
      ...builtInFeatureIds,
    ] as string[];

    logService.info(
      `Discovered ${allExtensionIds.length} extensions (${builtInFeatureIds.length} built-in features)`
    );

    return allExtensionIds;
  } catch (err) {
    logService.error(`No extensions found or error during discovery: ${err}`);
    return [];
  }
}

// Helper to determine if an ID is from built-in directory
export function isBuiltInFeature(extensionId: string): boolean {
  const builtInPaths = Object.keys(builtInFeatureContext);
  const matchingPath = builtInPaths.find((path) =>
    path.includes(`/${extensionId}/`)
  );
  return !!matchingPath;
}

// Function to get the import path for an extension ID
export function getExtensionPath(extensionId: string): string {
  if (isBuiltInFeature(extensionId)) {
    return `../../built-in-features/${extensionId}`;
  } else {
    return `../../extensions/${extensionId}`;
  }
}


