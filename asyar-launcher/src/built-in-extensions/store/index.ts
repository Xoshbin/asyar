import type {
  ExtensionContext,
  Extension,
  IExtensionManager,
  ILogService,
  INotificationService,
  IActionService,
  ExtensionAction,
} from "asyar-api";
// Import the placeholder and the initializer function
import { storeViewState, initializeStore } from "./state";
import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import DefaultView from './DefaultView.svelte'; // Import component
import DetailView from './DetailView.svelte'; // Import component

const EXTENSION_ID = "store";
const ACTION_ID_INSTALL_DETAIL = "store-install-detail"; // Action ID for detail view
const ACTION_ID_INSTALL_SELECTED = "store-install-selected"; // Action ID for list view selection

// Define structure for install API response (needed for action)
interface InstallInfo {
  download_url: string;
  version: string;
}

export { DefaultView, DetailView };

class StoreExtension implements Extension {
  private extensionManager?: IExtensionManager;
  private logService?: ILogService;
  private actionService?: IActionService;
  private notificationService?: INotificationService;
  private listViewActionSubscription: (() => void) | null = null; // To hold the unsubscribe function
  private inView: boolean = false;
  private currentView: string | null = null;

  async initialize(context: ExtensionContext): Promise<void> {
    this.logService = context.getService<ILogService>("LogService");
    this.extensionManager =
      context.getService<IExtensionManager>("ExtensionManager");
    this.actionService = context.getService<IActionService>("ActionService");
    this.notificationService = context.getService<INotificationService>(
      "NotificationService"
    );

    // Initialize the store *after* getting services needed by the store itself
    initializeStore(); // Create the store instance

    // Pass logService and extensionManager to the now initialized store state
    if (this.logService) {
      storeViewState?.setLogService(this.logService);
    }
    if (this.extensionManager) {
      storeViewState?.setExtensionManager(this.extensionManager);
    }

    this.logService?.info(
      "Store extension initialized and state store initialized on demand."
    );
  }

  // --- Private Helper for Installation ---
  private async _installExtension(slug: string, name?: string): Promise<void> {
    if (!slug) {
      this.logService?.error("Install function called without a slug.");
      this.notificationService?.notify({
        title: "Install Failed",
        body: "Could not determine which extension to install.",
      });
      return;
    }
    const displayName = name || slug; // Use name if provided, otherwise slug

    this.logService?.info(`Install action triggered for slug: ${slug}`);
    try {
      // 1. Get install info
      const installInfoResponse = await fetch(
        `http://asyar-website.test/api/extensions/${slug}/install`
      );
      if (!installInfoResponse.ok) {
        throw new Error(
          `Failed to get install info: ${
            installInfoResponse.status
          } ${await installInfoResponse.text()}`
        );
      }
      const installInfo: InstallInfo = await installInfoResponse.json();
      this.logService?.info(
        `Install info received: Version ${installInfo.version}, URL: ${installInfo.download_url}`
      );

      // 2. Trigger installation via Tauri command
      this.logService?.info(
        `Invoking Tauri command 'install_extension_from_url' for ${displayName}`
      );
      await invoke("install_extension_from_url", {
        downloadUrl: installInfo.download_url,
        extensionId: slug,
        extensionName: displayName, // Use the determined name
        version: installInfo.version,
      });

      this.logService?.info(
        `Installation command invoked successfully for ${displayName}. App might reload extensions.`
      );
      this.notificationService?.notify({
        title: "Installation Started",
        body: `Installation for ${displayName} initiated. App may reload.`,
      });
    } catch (e: any) {
      this.logService?.error(
        `Installation failed for ${displayName}: ${e.message}`
      );
      this.notificationService?.notify({
        title: "Installation Failed",
        body: `Could not install ${displayName}. ${e.message}`,
      });
    }
  }
  // --- End Private Helper ---

  async executeCommand(
    commandId: string,
    _args?: Record<string, any>
  ): Promise<any> {
    this.logService?.info(`Store executing command: ${commandId}`);

    // The commandId parameter received here is the *short* ID from the manifest
    const expectedShortCommandId = "browse";

    if (commandId === expectedShortCommandId) {
      this.logService?.debug('[Store Extension] Browse command handler executed.');
      if (this.extensionManager) {
        this.extensionManager.navigateToView(`${EXTENSION_ID}/DefaultView`);
        return { success: true };
      } else {
        this.logService?.error("ExtensionManager service not available.");
        return { success: false, error: "ExtensionManager not available" };
      }
    } else {
      this.logService?.warn(`Received unknown command ID for store: ${commandId}`);
      throw new Error(`Unknown command for store: ${commandId}`);
    }
  }

  // Helper method to fetch extensions
  private async fetchExtensions() {
    if (!storeViewState) return;
    
    this.logService?.debug('[Store Extension] fetchExtensions: Starting fetch...');
    storeViewState.setLoading(true);
    try {
      const response = await fetch('http://asyar-website.test/api/extensions');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      const fetchedExtensions = Array.isArray(data) ? data : (data.data || []);
      this.logService?.info(`Fetched ${fetchedExtensions.length} extensions.`);
      storeViewState.setItems(fetchedExtensions);
    } catch (e: any) {
      this.logService?.error(`Failed to fetch extensions: ${e.message}`);
      storeViewState.setError(`Failed to load extensions: ${e.message}`);
    }
  }

  private handleKeydownBound = (event: KeyboardEvent) => this.handleKeydown(event);

  private handleKeydown(event: KeyboardEvent) {
    if (!this.inView || !storeViewState) return;
    
    const state = get(storeViewState);
    if (!state.filteredItems.length) return;

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      storeViewState.moveSelection(event.key === "ArrowUp" ? 'up' : 'down');
    } else if (event.key === "Enter" && state.selectedIndex !== -1) {
      event.preventDefault();
      event.stopPropagation();
      const selectedItem = state.filteredItems[state.selectedIndex];
      if (selectedItem) {
        this.viewExtensionDetail(selectedItem.slug);
      }
    }
  }

  private viewExtensionDetail(slug: string) {
    if (!storeViewState) return;
    storeViewState.setSelectedExtensionSlug(slug);
    if (this.extensionManager) {
      this.extensionManager.navigateToView(`store/DetailView`);
    }
  }

  // Optional lifecycle methods
  async activate(): Promise<void> {
    this.logService?.info("Store extension activated.");
  }

  async deactivate(): Promise<void> {
    this.logService?.info("Store extension deactivated.");
  }

  // --- Action Registration ---

  // Action for Detail View
  private registerDetailViewActions(): void {
    if (!this.actionService) return;
    this.logService?.debug(`Registering action: ${ACTION_ID_INSTALL_DETAIL}`);

    const installAction: ExtensionAction = {
      id: ACTION_ID_INSTALL_DETAIL,
      title: "Install Extension",
      description: "Install the currently viewed extension",
      icon: "💾", 
      extensionId: EXTENSION_ID,
      execute: async () => {
        const store = initializeStore();
        const currentState = get(store); 
        const slug = currentState.selectedExtensionSlug;
        await this._installExtension(slug!, undefined); 
      },
    };
    this.actionService.registerAction(installAction);
  }

  private unregisterDetailViewActions(): void {
    if (!this.actionService) return;
    this.logService?.debug(`Unregistering action: ${ACTION_ID_INSTALL_DETAIL}`);
    this.actionService.unregisterAction(ACTION_ID_INSTALL_DETAIL);
  }

  // Action for List View Selection - Now manages subscription
  private registerListViewActions(): void {
    if (!this.actionService || this.listViewActionSubscription) return; // Prevent double subscription
    this.logService?.debug(
      `Setting up subscription for dynamic list view action: ${ACTION_ID_INSTALL_SELECTED}`
    );

    // Ensure store is initialized before subscribing
    const store = initializeStore();
    if (!store) {
        this.logService?.error("Cannot register list view actions: Store not initialized.");
        return;
    }

    // Subscribe to the store state
    this.listViewActionSubscription = store.subscribe((state) => {
      // Always unregister the previous action first inside the subscription
      this.actionService?.unregisterAction(ACTION_ID_INSTALL_SELECTED);
      // Clear the primary action label initially using the manager
      this.extensionManager?.setActiveViewActionLabel(null);

      const selectedItem = state.selectedItem;

      // Only register if an item is actually selected
      if (selectedItem) {
        // Set the primary action label for the list view using the manager
        this.extensionManager?.setActiveViewActionLabel("Show Details");
        this.logService?.debug(
          `Set primary action label to "Show Details" via manager for ${selectedItem.name}`
        );

        // Register the "Install Selected" action (for Cmd+K)
        const dynamicTitle = `Install ${selectedItem.name} Extension`;
        this.logService?.debug(
          `Registering/Updating action ${ACTION_ID_INSTALL_SELECTED} with title: "${dynamicTitle}"`
        );
        const installSelectedAction: ExtensionAction = {
          id: ACTION_ID_INSTALL_SELECTED,
          title: dynamicTitle, 
          description: `Install the ${selectedItem.name} extension`, 
          icon: "💾", 
          extensionId: EXTENSION_ID,
          execute: async () => {
            const currentStore = initializeStore();
            const currentSelectedItem = currentStore ? get(currentStore).selectedItem : null; 
            if (currentSelectedItem) {
              await this._installExtension(
                currentSelectedItem.slug,
                currentSelectedItem.name
              );
            } else {
              this.logService?.warn(
                "Install selected action executed, but no item is selected in state anymore."
              );
              this.notificationService?.notify({
                title: "Install Failed",
                body: "No extension selected.",
              });
            }
          },
        };
        this.actionService?.registerAction(installSelectedAction);
      } else {
        this.logService?.debug(
          `No item selected, action ${ACTION_ID_INSTALL_SELECTED} remains unregistered and primary label cleared via manager.`
        );
        this.extensionManager?.setActiveViewActionLabel(null);
      }
    });
  }

  private unregisterListViewActions(): void {
    if (this.listViewActionSubscription) {
      this.logService?.debug(`Unsubscribing from list view action updates.`);
      this.listViewActionSubscription(); // Call the unsubscribe function
      this.listViewActionSubscription = null;
    }
    // Ensure the action is unregistered regardless of subscription state
    if (this.actionService) {
      this.logService?.debug(
        `Unregistering action: ${ACTION_ID_INSTALL_SELECTED}`
      );
      this.actionService.unregisterAction(ACTION_ID_INSTALL_SELECTED);
    }
    // Also clear the primary action label via manager when unsubscribing/unregistering
    this.extensionManager?.setActiveViewActionLabel(null);
    this.logService?.debug(
      `Cleared primary action label via manager during list view action unregistration.`
    );
  }
  // --- End Action Registration ---

  // Required methods from Extension interface
  async viewActivated(viewPath: string): Promise<void> {
    this.logService?.debug(`Store view activated: ${viewPath}`);
    this.inView = true;
    this.currentView = viewPath;

    // Add global key listener
    window.addEventListener("keydown", this.handleKeydownBound);

    // Unregister actions from the *previous* view first, then register/update new ones
    this.extensionManager?.setActiveViewActionLabel(null); // Clear label initially via manager

    if (viewPath === `${EXTENSION_ID}/DetailView`) {
      this.unregisterListViewActions(); // Remove list action/label if detail view is shown
      this.registerDetailViewActions(); // Register Cmd+K action for detail view
      this.extensionManager?.setActiveViewActionLabel("Install Extension"); // Set primary label for detail view via manager
      this.logService?.debug(
        `Set primary action label to "Install Extension" via manager for detail view.`
      );
    } else if (viewPath === `${EXTENSION_ID}/DefaultView`) {
      this.unregisterDetailViewActions(); // Remove detail action if list view is shown
      this.registerListViewActions(); // This will set the label based on selection via subscription
      // Trigger fetch when list view is activated
      await this.fetchExtensions();
    } else {
      // If activating a view that's neither list nor detail, remove both actions and clear label
      this.unregisterDetailViewActions();
      this.unregisterListViewActions();
    }
  }

  async viewDeactivated(viewPath: string): Promise<void> {
    this.logService?.debug(`Store view deactivated: ${viewPath}`);
    this.inView = false;
    this.currentView = null;
    
    // Remove global key listener
    window.removeEventListener("keydown", this.handleKeydownBound);

    // Unregister actions and clear label specific to the deactivated view
    if (viewPath === `${EXTENSION_ID}/DetailView`) {
      this.unregisterDetailViewActions();
      this.extensionManager?.setActiveViewActionLabel(null); // Clear label when detail view is left via manager
      this.logService?.debug(
        `Cleared primary action label via manager as detail view deactivated.`
      );
    } else if (viewPath === `${EXTENSION_ID}/DefaultView`) {
      this.unregisterListViewActions(); // This already clears the label via manager
    }
  }

  onUnload(): void {
    // Ensure actions are unregistered on unload
    this.unregisterDetailViewActions();
    this.unregisterListViewActions(); // Also unregister list view actions
    this.logService?.info("Store extension unloading.");
  }

  // Add onViewSearch method
  async onViewSearch(query: string): Promise<void> {
    this.logService?.debug(`Store view search received: "${query}"`);
    // Ensure store is initialized before setting search
    const store = initializeStore();
    store?.setSearch(query); // Update the state store
  }
}

// Export an instance of the class
export default new StoreExtension();
