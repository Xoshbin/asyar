import { writable, get } from 'svelte/store';
import { logService } from '../log/logService';
import { searchQuery } from '../search/stores/search';
import type { ExtensionManifest } from 'asyar-api'; // Assuming types are available

// Stores managed by this service
export const activeView = writable<string | null>(null);
export const activeViewSearchable = writable<boolean>(false);

// Internal state
let savedMainQuery = "";
let currentExtensionId: string | null = null; // Track the ID of the extension owning the view

// Dependencies (will be set via init or passed)
let manifestsMap: Map<string, ExtensionManifest> | null = null;
let extensionSearchHandler: ((query: string) => Promise<void>) | null = null;
let extensionViewActivatedHandler: ((extensionId: string, viewPath: string) => void) | null = null;
let extensionViewDeactivatedHandler: ((extensionId: string | null, viewPath: string | null) => void) | null = null;


export const viewManager = {
    // Initialize with necessary dependencies from the main manager
    init(
        manifests: Map<string, ExtensionManifest>,
        searchHandler: (query: string) => Promise<void>,
        viewActivated: (extensionId: string, viewPath: string) => void,
        viewDeactivated: (extensionId: string | null, viewPath: string | null) => void
    ) {
        manifestsMap = manifests;
        extensionSearchHandler = searchHandler;
        extensionViewActivatedHandler = viewActivated;
        extensionViewDeactivatedHandler = viewDeactivated;
        logService.debug("ViewManager initialized.");
    },

    navigateToView(viewPath: string): void {
        if (!manifestsMap || !extensionViewActivatedHandler) {
             logService.error("ViewManager not initialized properly.");
             return;
        }
        const extensionId = viewPath.split('/')[0];
        const manifest = manifestsMap.get(extensionId); // Use ID for lookup

        if (manifest) {
            logService.info(`Navigating to view: ${viewPath} for extension: ${manifest.id}`);
            currentExtensionId = manifest.id; // Store the current extension ID

            // Save main query and clear it for the view
            savedMainQuery = get(searchQuery);
            searchQuery.set("");

            // Set view state
            activeViewSearchable.set(manifest.searchable ?? false);
            activeView.set(viewPath);

            // Notify the extension (via the main manager's handler)
            extensionViewActivatedHandler(manifest.id, viewPath);

            logService.debug(`Navigated to view: ${viewPath}, searchable: ${manifest.searchable}`);
        } else {
            logService.error(`Cannot navigate: No enabled extension found with ID: ${extensionId}`);
        }
    },

    closeView(): void {
        const currentViewPath = get(activeView);
        const closedExtensionId = currentExtensionId; // Get the ID before clearing
        logService.debug(`Closing view: ${currentViewPath}, restoring query: "${savedMainQuery}"`);

        // Reset view state
        activeView.set(null);
        activeViewSearchable.set(false);
        currentExtensionId = null; // Clear the current extension ID

        // Restore main search query
        searchQuery.set(savedMainQuery);
        savedMainQuery = ""; // Clear saved query

        // Notify the extension (if one was active)
        if (closedExtensionId && currentViewPath && extensionViewDeactivatedHandler) {
             extensionViewDeactivatedHandler(closedExtensionId, currentViewPath);
        }
    },

    async handleViewSearch(query: string): Promise<void> {
        if (get(activeView) && extensionSearchHandler) {
            try {
                await extensionSearchHandler(query);
            } catch (error) {
                 logService.error(`Error during handleViewSearch propagation: ${error}`);
            }
        } else if (!extensionSearchHandler) {
             logService.warn("View search attempted but no handler is registered.");
        }
    },

    getActiveView(): string | null {
        return get(activeView);
    },

    isViewActive(): boolean {
        return get(activeView) !== null;
    }
};

// Re-export stores for convenience if needed elsewhere, though direct import is fine
// export { activeView, activeViewSearchable };
