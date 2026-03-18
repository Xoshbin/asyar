import { logService } from "../log/logService";
import type { ExtensionManifest } from "asyar-api";

// Import both regular and built-in extensions
export const extensionContext = import.meta.glob("../../extensions/*/manifest.json");
export const builtInExtensionContext = import.meta.glob(
  "../../built-in-extensions/*/manifest.json"
);


export async function discoverExtensions(): Promise<string[]> {
  try {
    // Get all extension paths from both directories
    const extensionPaths = Object.keys(extensionContext);
    const builtInExtensionPaths = Object.keys(builtInExtensionContext);

    // Log the discovered paths for debugging
    logService.debug(
      `Found ${extensionPaths.length} regular extensions and ${builtInExtensionPaths.length} built-in extensions`
    );

    // Extract just the extension IDs (names) from the paths
    const regularExtensionIds = extensionPaths
      .map((path) => {
        const matches = path.match(/\/extensions\/([^\/]+)\/manifest\.json/);
        return matches ? matches[1] : null;
      })
      .filter((id) => id !== null);

    const builtInExtensionIds = builtInExtensionPaths
      .map((path) => {
        const matches = path.match(
          /\/built-in-extensions\/([^\/]+)\/manifest\.json/
        );
        return matches ? matches[1] : null;
      })
      .filter((id) => id !== null);

    // Combine and return just the extension IDs
    const allExtensionIds = [
      ...regularExtensionIds,
      ...builtInExtensionIds,
    ] as string[];

    logService.info(
      `Discovered ${allExtensionIds.length} extensions (${builtInExtensionIds.length} built-in)`
    );

    return allExtensionIds;
  } catch (err) {
    logService.error(`No extensions found or error during discovery: ${err}`);
    return [];
  }
}

// Helper to determine if an extension ID is from built-in directory
export function isBuiltInExtension(extensionId: string): boolean {
  const builtInPaths = Object.keys(builtInExtensionContext);
  const matchingPath = builtInPaths.find((path) =>
    path.includes(`/${extensionId}/`)
  );
  return !!matchingPath;
}

// Function to get the import path for an extension ID
export function getExtensionPath(extensionId: string): string {
  if (isBuiltInExtension(extensionId)) {
    return `../../built-in-extensions/${extensionId}`;
  } else {
    return `../../extensions/${extensionId}`;
  }
}


