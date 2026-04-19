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
        this.activeView = null;
        this.activeViewSearchable = false;
        this.moduleResolver = null;
        logService.debug("ViewManager initialized and state reset.");
    }

    navigateToView(viewPath: string): void {
        logService.info(`[ViewManager] navigateToView called with path: ${viewPath}`);
        if (!this.manifestsMap) {
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

            // Notify via module resolver (Tier 1 lifecycle)
            if (this.moduleResolver) {
                const module = this.moduleResolver.getModule(manifest.id);
                if (module) {
                    const ext = this.moduleResolver.resolveInstance(module);
                    if (ext && typeof ext.viewActivated === 'function') {
                        Promise.resolve(ext.viewActivated(viewPath)).catch(error => {
                            logService.error(`Error during viewActivated for ${manifest.id}: ${error}`);
                        });
                    }
                }
            }
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
            if (closedState) {
                if (this.moduleResolver) {
                    const module = this.moduleResolver.getModule(closedState.extensionId);
                    if (module) {
                        const ext = this.moduleResolver.resolveInstance(module);
                        if (ext && typeof ext.viewDeactivated === 'function') {
                            Promise.resolve(ext.viewDeactivated(closedState.viewPath)).catch(error => {
                                logService.error(`Error during viewDeactivated for ${closedState.extensionId}: ${error}`);
                            });
                        }
                    }
                }
            }
        } else {
            // Stack is not empty, returning to the previous view in the stack
            const newState = this.navigationStack[this.navigationStack.length - 1]; // Get the new top state
            logService.debug(`Returning to previous view: ${newState.viewPath}`);

            // Update active view stores to reflect the new top state
            this.activeView = newState.viewPath;
            this.activeViewSearchable = newState.searchable;

            // Notify about activation of the view we are returning to
            if (this.moduleResolver) {
                const module = this.moduleResolver.getModule(newState.extensionId);
                if (module) {
                    const ext = this.moduleResolver.resolveInstance(module);
                    if (ext && typeof ext.viewActivated === 'function') {
                        Promise.resolve(ext.viewActivated(newState.viewPath)).catch(error => {
                            logService.error(`Error during viewActivated for ${newState.extensionId}: ${error}`);
                        });
                    }
                }
            }
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
