import { logService } from '../log/logService';
import { searchStores } from '../search/stores/search.svelte';
import { extensionIframeManager } from './extensionIframeManager.svelte';
import type { ExtensionManifest, Extension } from 'asyar-sdk';

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
    // See withReplacementSemantics(); consumed by the next navigateToView.
    private replacementPending: boolean = false;
    private manifestsMap: Map<string, ExtensionManifest> | null = null;
    private moduleResolver: {
        getModule: (id: string) => unknown | undefined;
        resolveInstance: (module: unknown) => Extension;
    } | null = null;

    setModuleResolver(resolver: {
        getModule: (id: string) => unknown | undefined;
        resolveInstance: (module: unknown) => Extension;
    }): void {
        this.moduleResolver = resolver;
    }

    // Initialize with necessary dependencies from the main manager
    init(manifests: Map<string, ExtensionManifest>): void {
        this.manifestsMap = manifests;
        // Reset internal state on init
        this.navigationStack = [];
        this.initialMainQuery = null;
        this.replacementPending = false;
        this.activeView = null;
        this.activeViewSearchable = false;
        this.moduleResolver = null;
        logService.debug("ViewManager initialized and state reset.");
    }

    /**
     * Run `fn` so the first navigateToView inside it replaces the top of
     * the stack instead of pushing. A global item-hotkey is a fresh entry
     * point: the launched view should sit at the bottom of the stack so
     * escape returns to main, not to whatever the user happened to be in
     * before.
     */
    async withReplacementSemantics<T>(fn: () => Promise<T>): Promise<T> {
        this.replacementPending = true;
        try {
            return await fn();
        } finally {
            this.replacementPending = false;
        }
    }

    navigateToView(viewPath: string): void {
        logService.info(`[ViewManager] navigateToView called with path: ${viewPath}`);
        if (!this.manifestsMap) {
             logService.error("ViewManager not initialized properly.");
             return;
        }
        const extensionId = viewPath.split('/')[0];
        const manifest = this.manifestsMap.get(extensionId);

        if (!manifest) {
            logService.error(`Cannot navigate: No enabled extension found with ID: ${extensionId}`);
            return;
        }

        // Drill-down after initial hotkey land pushes normally.
        const replace = this.replacementPending;
        this.replacementPending = false;

        if (replace && this.navigationStack.length > 0) {
            // Mutate activeView exactly once (old → new) below, not old→null→new,
            // so the hotkey swap is one reactive update with no main-launcher frame.
            const prevTop = this.navigationStack[this.navigationStack.length - 1];
            this.navigationStack = [];
            this.initialMainQuery = null;
            this.notifyViewDeactivated(prevTop);
        }

        logService.info(`Navigating to view: ${viewPath} for extension: ${manifest.id}`);

        // Capture the main query so escape-to-root can restore it. Hotkey
        // replacement discarded any prior capture above.
        if (this.navigationStack.length === 0) {
            this.initialMainQuery = searchStores.query;
            logService.debug(`First view navigation, saving initial query: "${this.initialMainQuery}"`);
        }

        const newState: NavigationState = {
            viewPath,
            searchable: manifest.searchable ?? false,
            extensionId: manifest.id,
        };
        this.navigationStack.push(newState);

        this.activeView = newState.viewPath;
        this.activeViewSearchable = newState.searchable;

        // Clear search query for the new view
        searchStores.query = "";

        this.notifyViewActivated(newState);
        logService.debug(`Navigated to view: ${viewPath}, searchable: ${newState.searchable}. Stack size: ${this.navigationStack.length}`);
    }

    private notifyViewActivated(state: NavigationState): void {
        if (!this.moduleResolver) return;
        const module = this.moduleResolver.getModule(state.extensionId);
        if (!module) return;
        const ext = this.moduleResolver.resolveInstance(module);
        if (typeof ext?.viewActivated !== 'function') return;
        Promise.resolve(ext.viewActivated(state.viewPath)).catch(error => {
            logService.error(`Error during viewActivated for ${state.extensionId}: ${error}`);
        });
    }

    private notifyViewDeactivated(state: NavigationState): void {
        if (!this.moduleResolver) return;
        const module = this.moduleResolver.getModule(state.extensionId);
        if (!module) return;
        const ext = this.moduleResolver.resolveInstance(module);
        if (typeof ext?.viewDeactivated !== 'function') return;
        Promise.resolve(ext.viewDeactivated(state.viewPath)).catch(error => {
            logService.error(`Error during viewDeactivated for ${state.extensionId}: ${error}`);
        });
    }

    goBack(): void {
        if (this.navigationStack.length === 0) {
            logService.warn("goBack called but navigation stack is empty.");
            return;
        }

        const closedState = this.navigationStack.pop()!; // Remove the current view state
        logService.debug(`Going back from view: ${closedState.viewPath}. Stack size after pop: ${this.navigationStack.length}`);

        if (this.navigationStack.length === 0) {
            // Stack is empty, returning to main application view
            logService.debug(`Navigation stack empty, returning to main view.`);
            this.activeView = null;
            this.activeViewSearchable = false;

            // Restore the initial main search query
            logService.debug(`Restoring initial main query: "${this.initialMainQuery}"`);
            searchStores.query = this.initialMainQuery ?? "";
            this.initialMainQuery = null; // Clear the saved initial query

            this.notifyViewDeactivated(closedState);
        } else {
            // Stack is not empty, returning to the previous view in the stack
            const newState = this.navigationStack[this.navigationStack.length - 1]; // Get the new top state
            logService.debug(`Returning to previous view: ${newState.viewPath}`);

            // Update active view stores to reflect the new top state
            this.activeView = newState.viewPath;
            this.activeViewSearchable = newState.searchable;

            this.notifyViewActivated(newState);
        }
    }

    async handleViewSearch(query: string): Promise<void> {
        if (!this.activeView) return;

        if (this.moduleResolver) {
            const extensionId = this.activeView.split('/')[0];
            const module = this.moduleResolver.getModule(extensionId);

            if (module) {
                const extensionInstance = this.moduleResolver.resolveInstance(module);
                if (extensionInstance && typeof extensionInstance.onViewSearch === 'function') {
                    try {
                        await extensionInstance.onViewSearch(query);
                    } catch (error) {
                        logService.error(`[ViewManager] Error calling onViewSearch for ${extensionId}: ${error}`);
                    }
                }
            } else {
                extensionIframeManager.sendViewSearchToExtension(extensionId, query);
            }
            return;
        }

    }

    async handleViewSubmit(query: string): Promise<void> {
        if (!this.activeView) return;

        if (this.moduleResolver) {
            const extensionId = this.activeView.split('/')[0];
            const module = this.moduleResolver.getModule(extensionId);

            if (module) {
                const extensionInstance = this.moduleResolver.resolveInstance(module);
                if (extensionInstance && typeof extensionInstance.onViewSubmit === 'function') {
                    try {
                        await extensionInstance.onViewSubmit(query);
                    } catch (error) {
                        logService.error(`[ViewManager] Error calling onViewSubmit for ${extensionId}: ${error}`);
                    }
                    return;
                }
            }

            extensionIframeManager.handleExtensionSubmit(extensionId, query);
            return;
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
