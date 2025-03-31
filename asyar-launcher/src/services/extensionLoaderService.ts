import { logService } from './log/logService'; // Adjusted path
import { performanceService } from './performance/performanceService'; // Adjusted path
import { discoverExtensions, isBuiltInExtension } from './extension/extensionDiscovery'; // Adjusted path
import type { Extension, ExtensionManifest } from 'asyar-api';

export const extensionLoaderService = {

    async loadAllExtensions(): Promise<Map<string, { extension: Extension, manifest: ExtensionManifest }>> {
        const loadedExtensions = new Map<string, { extension: Extension, manifest: ExtensionManifest }>();
        try {
            performanceService.startTiming("extension-discovery");
            const extensionIds = await discoverExtensions();
            logService.debug(`Discovery returned ${extensionIds.length} extension IDs`);
            performanceService.stopTiming("extension-discovery");

            const extensionPairs = await Promise.all(
                extensionIds.map(id => this.loadSingleExtension(id))
            );

            for (const pair of extensionPairs) {
                if (pair) {
                    // Ensure manifest has an ID before setting
                    if (pair.manifest && pair.manifest.id) {
                        loadedExtensions.set(pair.manifest.id, { extension: pair.extension, manifest: pair.manifest });
                    } else {
                        logService.warn(`Loaded extension pair is missing manifest ID. Skipping.`);
                    }
                }
            }
            logService.debug(`Successfully attempted loading for ${extensionPairs.length} discovered extensions. ${loadedExtensions.size} loaded.`);
            return loadedExtensions;

        } catch (error) {
            logService.error(`Failed during extension loading process: ${error}`);
            return loadedExtensions; // Return potentially partially loaded extensions
        }
    },

    async loadSingleExtension(id: string): Promise<{ extension: Extension, manifest: ExtensionManifest } | null> {
        // Path logic remains the same relative to the project root
        const path = isBuiltInExtension(id)
            ? `../built-in-extensions/${id}` // Relative path from src/services/
            : `../extensions/${id}`; // Relative path from src/services/
        const manifestPath = `${path}/manifest.json`;

        try {
            performanceService.startTiming(`load-extension:${id}`); // Use ID for timing
            // Use Promise.allSettled to handle potential errors in either import gracefully
            const results = await Promise.allSettled([
                import(/* @vite-ignore */ path),
                import(/* @vite-ignore */ manifestPath),
            ]);

            const extensionResult = results[0];
            const manifestResult = results[1];

            // Check manifest first
            if (manifestResult.status === 'rejected') {
                 // Don't log full error for non-existent manifests, just debug log
                 if (manifestResult.reason instanceof Error && manifestResult.reason.message.includes('Failed to fetch dynamically imported module')) {
                    logService.debug(`Manifest not found for potential extension ${id} at ${manifestPath}, likely not an extension directory.`);
                 } else {
                    logService.warn(`Failed to load manifest for extension ${id} from ${manifestPath}: ${manifestResult.reason}`);
                 }
                 performanceService.stopTiming(`load-extension:${id}`);
                 return null;
            }
             const manifestModule = manifestResult.value;
             const manifest = (manifestModule.default || manifestModule) as ExtensionManifest; // Handle potential default export

             if (!manifest || !manifest.id || !manifest.name) {
                 logService.warn(`Invalid or incomplete manifest loaded from ${manifestPath}`);
                 performanceService.stopTiming(`load-extension:${id}`);
                 return null;
             }
             // Ensure loaded manifest ID matches the directory ID
             if (manifest.id !== id) {
                 logService.error(`Manifest ID "${manifest.id}" does not match directory ID "${id}" for path ${path}. Skipping.`);
                 performanceService.stopTiming(`load-extension:${id}`);
                 return null;
             }


            // Check extension module
            if (extensionResult.status === 'rejected') {
                logService.error(`Failed to load extension module for ${id} from ${path}: ${extensionResult.reason}`);
                performanceService.stopTiming(`load-extension:${id}`);
                return null; // Cannot proceed without the extension code
            }
            const extensionModule = extensionResult.value;
            const extension = extensionModule.default as Extension; // Assuming default export

            if (!extension) {
                logService.error(`Invalid extension loaded from ${path}: missing default export`);
                performanceService.stopTiming(`load-extension:${id}`);
                return null;
            }
            if (typeof extension.executeCommand !== 'function') {
                logService.error(`Invalid extension loaded from ${path}: missing required executeCommand method`);
                performanceService.stopTiming(`load-extension:${id}`);
                return null;
            }


            // Success
            logService.info(`Successfully loaded extension: ${manifest.id} (${manifest.name})`);
            const metrics = performanceService.stopTiming(`load-extension:${id}`);
            logService.debug(`Loaded extension module & manifest for ${id} in ${metrics.duration?.toFixed(2)}ms`);

            return { extension, manifest };

        } catch (error) { // Catch any unexpected errors during the process
            logService.error(`Unexpected error loading extension ${id} from ${path}: ${error}`);
            performanceService.stopTiming(`load-extension:${id}`); // Ensure timing stops on error
            return null;
        }
    }
};
