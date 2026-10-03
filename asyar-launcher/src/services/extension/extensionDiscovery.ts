import { logService } from '../log/logService';
import type { ExtensionManifest } from 'asyar-sdk/contracts';

/**
 * Statically compiled registry of built-in platform features.
 * Eliminates runtime manifest directory scanning and double-parsing.
 */
export const BUILT_IN_FEATURE_IDS = new Set<string>([
  'agents',
  'aliases',
  'calculator',
  'clipboard-history',
  'create-extension',
  'feedback',
  'file-search',
  'help',
  'mcp',
  'notes',
  'portals',
  'quit',
  'raycast-import',
  'runs',
  'screen-ocr',
  'scripts',
  'settings',
  'shortcuts',
  'snippets',
  'store',
  'system',
  'usage-stats',
  'walkthrough',
  'window-management',
]);

/**
 * Platform infrastructure features that cannot be disabled.
 */
export const NON_DISABLEABLE_BUILT_IN_IDS = new Set<string>(['system', 'settings']);

// Import both regular and built-in features
export const extensionContext = import.meta.glob('../../extensions/*/manifest.json');
export const builtInFeatureContext = import.meta.glob('../../built-in-features/*/manifest.json');

export async function discoverExtensions(): Promise<string[]> {
  try {
    const extensionPaths = Object.keys(extensionContext);
    const regularExtensionIds = extensionPaths
      .map((path) => {
        const matches = path.match(/\/extensions\/([^\/]+)\/manifest\.json/);
        return matches ? matches[1] : null;
      })
      .filter((id): id is string => id !== null);

    const builtInFeatureIds = Array.from(BUILT_IN_FEATURE_IDS);
    const allExtensionIds = [...regularExtensionIds, ...builtInFeatureIds];

    logService.info(
      `Discovered ${allExtensionIds.length} extensions (${builtInFeatureIds.length} built-in features)`,
    );

    return allExtensionIds;
  } catch (err) {
    logService.error(`No extensions found or error during discovery: ${err}`);
    return [];
  }
}

// Fast static check for built-in platform features (zero-cost Set lookup)
export function isBuiltInFeature(extensionId: string): boolean {
  return BUILT_IN_FEATURE_IDS.has(extensionId);
}

export const builtInManifestContext = import.meta.glob<ExtensionManifest>(
  '../../built-in-features/*/manifest.json',
  { eager: true, import: 'default' },
);

export function getBuiltInManifest(extensionId: string): ExtensionManifest | undefined {
  const match = Object.entries(builtInManifestContext).find(([path]) =>
    path.includes(`/${extensionId}/manifest.json`),
  );
  return match ? match[1] : undefined;
}

export function isBuiltInDisableable(extensionId: string): boolean {
  if (!isBuiltInFeature(extensionId)) return true;
  return !NON_DISABLEABLE_BUILT_IN_IDS.has(extensionId);
}

// Function to get the import path for an extension ID
export function getExtensionPath(extensionId: string): string {
  if (isBuiltInFeature(extensionId)) {
    return `../../built-in-features/${extensionId}`;
  } else {
    return `../../extensions/${extensionId}`;
  }
}
