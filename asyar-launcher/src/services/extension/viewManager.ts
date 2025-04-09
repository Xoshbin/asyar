import { writable, get } from 'svelte/store';
import { logService } from '../log/logService';
import { searchQuery } from '../search/stores/search';
import type { ExtensionManifest } from 'asyar-api'; // Assuming types are available

// Stores managed by this service
export const activeView = writable<string | null>(null);
export const activeViewSearchable = writable<boolean>(false);

// Internal state for navigation stack
interface NavigationState {
    viewPath: string;
    searchable: boolean;
    extensionId: string;
}
let navigationStack: NavigationState[] = [];
let initialMainQuery: string | null = null; // Store the query only when the first view is pushed

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
        // Reset internal state on init
        navigationStack = [];
        initialMainQuery = null;
        activeView.set(null);
        activeViewSearchable.set(false);
        logService.debug("ViewManager initialized and state reset.");
    },

    navigateToView(viewPath: string): void {
        logService.info(`[ViewManager] navigateToView called with path: ${viewPath}`); // <-- Added log
        if (!manifestsMap || !extensionViewActivatedHandler) {
             logService.error("ViewManager not initialized properly.");
             return;
        }
        const extensionId = viewPath.split('/')[0];
        const manifest = manifestsMap.get(extensionId); // Use ID for lookup

        if (manifest) {
            logService.info(`Navigating to view: ${viewPath} for extension: ${manifest.id}`);

            // If this is the first view being pushed onto the stack, save the main query
            if (navigationStack.length === 0) {
                initialMainQuery = get(searchQuery);
                logService.debug(`First view navigation, saving initial query: "${initialMainQuery}"`);
            }

            // Push new state onto the stack
            const newState: NavigationState = {
                viewPath,
                searchable: manifest.searchable ?? false,
                extensionId: manifest.id,
            };
            navigationStack.push(newState);

            // Update active view stores based on the new top of the stack
            activeView.set(newState.viewPath);
            activeViewSearchable.set(newState.searchable);

            // Clear search query for the new view
            searchQuery.set("");

            // Notify the extension (via the main manager's handler)
            extensionViewActivatedHandler(manifest.id, viewPath);

            logService.debug(`Navigated to view: ${viewPath}, searchable: ${newState.searchable}. Stack size: ${navigationStack.length}`);
        } else {
            logService.error(`Cannot navigate: No enabled extension found with ID: ${extensionId}`);
        }
    },

    // Renamed from closeView
    goBack(): void {
        if (navigationStack.length === 0) {
            logService.warn("goBack called but navigation stack is empty.");
            return;
        }

        const closedState = navigationStack.pop(); // Remove the current view state
        logService.debug(`Going back from view: ${closedState?.viewPath}. Stack size after pop: ${navigationStack.length}`);

        if (navigationStack.length === 0) {
            // Stack is empty, returning to main application view
            logService.debug(`Navigation stack empty, returning to main view.`);
            activeView.set(null);
            activeViewSearchable.set(false);

            // Restore the initial main search query
            logService.debug(`Restoring initial main query: "${initialMainQuery}"`);
            searchQuery.set(initialMainQuery ?? "");
            initialMainQuery = null; // Clear the saved initial query

            // Notify about deactivation of the last view
            if (closedState && extensionViewDeactivatedHandler) {
                 extensionViewDeactivatedHandler(closedState.extensionId, closedState.viewPath);
            }
        } else {
            // Stack is not empty, returning to the previous view in the stack
            const newState = navigationStack[navigationStack.length - 1]; // Get the new top state
            logService.debug(`Returning to previous view: ${newState.viewPath}`);

            // Update active view stores to reflect the new top state
            activeView.set(newState.viewPath);
            activeViewSearchable.set(newState.searchable);

            // Notify about activation of the view we are returning to
            // Note: We might also want a 'viewReturnedTo' handler if extensions need
            // specific logic for this case, distinct from initial activation.
            // For now, we call activated again.
            if (extensionViewActivatedHandler) {
                extensionViewActivatedHandler(newState.extensionId, newState.viewPath);
            }
             // We could optionally call deactivated for the closedState here as well if needed.
             // if (closedState && extensionViewDeactivatedHandler) {
             //     extensionViewDeactivatedHandler(closedState.extensionId, closedState.viewPath);
             // }
        }
    },

    async handleViewSearch(query: string): Promise<void> {
        // This logic remains the same, relies on activeView store being correct
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
        // Returns the current view path from the store
        return get(activeView);
    },

    isViewActive(): boolean {
        // Checks if a view is currently active based on the store
        return get(activeView) !== null;
    },

    // Helper to get the current stack size (for debugging or potential future use)
    getNavigationStackSize(): number {
        return navigationStack.length;
    }
};

// Re-export stores for convenience if needed elsewhere, though direct import is fine
// export { activeView, activeViewSearchable };
