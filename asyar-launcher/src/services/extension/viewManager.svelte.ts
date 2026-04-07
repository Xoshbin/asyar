import { logService } from '../log/logService';
import { searchStores } from '../search/stores/search.svelte';
import type { ExtensionManifest } from 'asyar-sdk';

// Internal state for navigation stack
interface NavigationState {
    viewPath: string;
    searchable: boolean;
    extensionId: string;
}

class ViewManagerClass {
    activeView = $state<string | null>(null);
    activeViewSearchable = $state<boolean>(false);
    activeViewPrimaryActionLabel = $state<string | null>(null);
    activeViewSubtitle = $state<string | null>(null);

    // Internal state (NOT $state — not reactive)
    private navigationStack: NavigationState[] = [];
    private initialMainQuery: string | null = null;
    private manifestsMap: Map<string, ExtensionManifest> | null = null;
    private extensionSearchHandler: ((query: string) => Promise<void>) | null = null;
    private extensionSubmitHandler: ((query: string) => Promise<void>) | null = null;
    private extensionViewActivatedHandler: ((extensionId: string, viewPath: string) => void) | null = null;
    private extensionViewDeactivatedHandler: ((extensionId: string | null, viewPath: string | null) => void) | null = null;

    // Initialize with necessary dependencies from the main manager
    init(
        manifests: Map<string, ExtensionManifest>,
        searchHandler: (query: string) => Promise<void>,
        submitHandler: (query: string) => Promise<void>,
        viewActivated: (extensionId: string, viewPath: string) => void,
        viewDeactivated: (extensionId: string | null, viewPath: string | null) => void
    ) {
        this.manifestsMap = manifests;
        this.extensionSearchHandler = searchHandler;
        this.extensionSubmitHandler = submitHandler;
        this.extensionViewActivatedHandler = viewActivated;
        this.extensionViewDeactivatedHandler = viewDeactivated;
        // Reset internal state on init
        this.navigationStack = [];
        this.initialMainQuery = null;
        this.activeView = null;
        this.activeViewSearchable = false;
        logService.debug("ViewManager initialized and state reset.");
    }

    navigateToView(viewPath: string): void {
        logService.info(`[ViewManager] navigateToView called with path: ${viewPath}`);
        if (!this.manifestsMap || !this.extensionViewActivatedHandler) {
             logService.error("ViewManager not initialized properly.");
             return;
        }
        const extensionId = viewPath.split('/')[0];
        const manifest = this.manifestsMap.get(extensionId);

        if (manifest) {
            logService.info(`Navigating to view: ${viewPath} for extension: ${manifest.id}`);

            // If this is the first view being pushed onto the stack, save the main query
            if (this.navigationStack.length === 0) {
                this.initialMainQuery = searchStores.query;
                logService.debug(`First view navigation, saving initial query: "${this.initialMainQuery}"`);
            }

            // Push new state onto the stack
            const newState: NavigationState = {
                viewPath,
                searchable: manifest.searchable ?? false,
                extensionId: manifest.id,
            };
            this.navigationStack.push(newState);

            // Update active view stores based on the new top of the stack
            this.activeView = newState.viewPath;
            this.activeViewSearchable = newState.searchable;

            // Clear search query for the new view
            searchStores.query = "";

            // Notify the extension (via the main manager's handler)
            this.extensionViewActivatedHandler(manifest.id, viewPath);

            logService.debug(`Navigated to view: ${viewPath}, searchable: ${newState.searchable}. Stack size: ${this.navigationStack.length}`);
        } else {
            logService.error(`Cannot navigate: No enabled extension found with ID: ${extensionId}`);
        }
    }

    goBack(): void {
        if (this.navigationStack.length === 0) {
            logService.warn("goBack called but navigation stack is empty.");
            return;
        }

        const closedState = this.navigationStack.pop(); // Remove the current view state
        logService.debug(`Going back from view: ${closedState?.viewPath}. Stack size after pop: ${this.navigationStack.length}`);

        if (this.navigationStack.length === 0) {
            // Stack is empty, returning to main application view
            logService.debug(`Navigation stack empty, returning to main view.`);
            this.activeView = null;
            this.activeViewSearchable = false;

            // Restore the initial main search query
            logService.debug(`Restoring initial main query: "${this.initialMainQuery}"`);
            searchStores.query = this.initialMainQuery ?? "";
            this.initialMainQuery = null; // Clear the saved initial query

            // Notify about deactivation of the last view
            if (closedState && this.extensionViewDeactivatedHandler) {
                 this.extensionViewDeactivatedHandler(closedState.extensionId, closedState.viewPath);
            }
        } else {
            // Stack is not empty, returning to the previous view in the stack
            const newState = this.navigationStack[this.navigationStack.length - 1]; // Get the new top state
            logService.debug(`Returning to previous view: ${newState.viewPath}`);

            // Update active view stores to reflect the new top state
            this.activeView = newState.viewPath;
            this.activeViewSearchable = newState.searchable;

            // Notify about activation of the view we are returning to
            if (this.extensionViewActivatedHandler) {
                this.extensionViewActivatedHandler(newState.extensionId, newState.viewPath);
            }
        }
    }

    async handleViewSearch(query: string): Promise<void> {
        if (this.activeView && this.extensionSearchHandler) {
            try {
                await this.extensionSearchHandler(query);
            } catch (error) {
                 logService.error(`Error during handleViewSearch propagation: ${error}`);
            }
        } else if (!this.extensionSearchHandler) {
             logService.warn("View search attempted but no handler is registered.");
        }
    }

    async handleViewSubmit(query: string): Promise<void> {
        if (this.activeView && this.extensionSubmitHandler) {
            try {
                await this.extensionSubmitHandler(query);
            } catch (error) {
                 logService.error(`Error during handleViewSubmit propagation: ${error}`);
            }
        }
    }

    getActiveView(): string | null {
        return this.activeView;
    }

    isViewActive(): boolean {
        return this.activeView !== null;
    }

    getNavigationStackSize(): number {
        return this.navigationStack.length;
    }
}

export const viewManager = new ViewManagerClass();
