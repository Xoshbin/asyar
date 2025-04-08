import type { ExtensionContext, Extension, IExtensionManager, ILogService, INotificationService, IActionService, ExtensionAction } from "asyar-api"; // Added INotificationService, IActionService, ExtensionAction
import { storeViewState } from "./state"; // Import the state
import { get } from 'svelte/store'; // Import get to read store value
import { invoke } from '@tauri-apps/api/core'; // Import invoke for Tauri command
import ExtensionListView from "./ExtensionListView.svelte";

const EXTENSION_ID = "store"; // Define the extension ID

// Define structure for install API response (needed for action)
interface InstallInfo {
  download_url: string;
  version: string;
}

class StoreExtension implements Extension {
  private extensionManager?: IExtensionManager;
  private logService?: ILogService;
  private actionService?: IActionService; // Add ActionService instance
  private notificationService?: INotificationService; // Add NotificationService instance
  private currentViewIsDetail = false; // Track if detail view is active

  async initialize(context: ExtensionContext): Promise<void> {
    this.logService = context.getService<ILogService>("LogService");
    this.extensionManager = context.getService<IExtensionManager>("ExtensionManager");
    this.actionService = context.getService<IActionService>("ActionService"); // Get ActionService
    this.notificationService = context.getService<INotificationService>("NotificationService"); // Get NotificationService
    // Initialize the state store with the context
    storeViewState.initializeServices(context); 
    this.logService?.info("Store extension initialized and state services initialized.");
  }

  async executeCommand(
    commandId: string,
    args?: Record<string, any>
  ): Promise<any> {
    this.logService?.info(`Store executing command: ${commandId}`);

    // The commandId parameter received here is the *short* ID from the manifest
    const expectedShortCommandId = "browse"; 

    if (commandId === expectedShortCommandId) { // Compare against the short ID
      if (this.extensionManager) {
        // Navigate to the view using the manager
        // The path is relative to the extension's directory
        this.extensionManager.navigateToView(
          `${EXTENSION_ID}/ExtensionListView`
        );
        return { success: true };
      } else {
        this.logService?.error("ExtensionManager service not available.");
        return { success: false, error: "ExtensionManager not available" };
      }
    } else {
      this.logService?.warn(
        `Received unknown command ID for store: ${commandId}`
      );
      throw new Error(`Unknown command for store: ${commandId}`);
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
  private async registerDetailViewActions(): Promise<void> {
    if (!this.actionService) return;
    this.logService?.debug("Registering store detail view actions...");

    const installAction: ExtensionAction = {
      id: "store-install-current",
      title: "Install Extension",
      description: "Install the currently viewed extension", // Use description instead of subtitle
      icon: "💾", // Example icon
      extensionId: EXTENSION_ID,
      execute: async () => {
        const currentState = get(storeViewState); // Get current state
        const slug = currentState.selectedExtensionSlug;
        // We might need the name too, ideally fetch details again or store more in state
        // For now, let's assume slug is enough for install command

        if (!slug) {
          this.logService?.error("Install action executed but no slug found in state.");
          this.notificationService?.notify({ title: 'Install Failed', body: 'Could not determine which extension to install.' });
          return;
        }

        this.logService?.info(`Install action triggered for slug: ${slug}`);
        // Re-implement install logic here
        try {
          // 1. Get install info
          const installInfoResponse = await fetch(`http://asyar-website.test/api/extensions/${slug}/install`);
          if (!installInfoResponse.ok) {
            throw new Error(`Failed to get install info: ${installInfoResponse.status}`);
          }
          const installInfo: InstallInfo = await installInfoResponse.json();
          this.logService?.info(`Install info received: Version ${installInfo.version}, URL: ${installInfo.download_url}`);

          // 2. Trigger installation via Tauri command
          this.logService?.info(`Invoking Tauri command 'install_extension_from_url' for ${slug}`);
          // We might lack the 'name' here, the command might need adjustment or we fetch details first
          await invoke('install_extension_from_url', {
            downloadUrl: installInfo.download_url,
            extensionId: slug, 
            extensionName: slug, // Using slug as placeholder for name
            version: installInfo.version
          });

          this.logService?.info(`Installation command invoked successfully for ${slug}. App might reload extensions.`);
          this.notificationService?.notify({ title: 'Installation Started', body: `Installation for ${slug} initiated. App may reload.` });

        } catch (e: any) {
          this.logService?.error(`Installation failed for ${slug}: ${e.message}`);
          this.notificationService?.notify({ title: 'Installation Failed', body: `Could not install ${slug}. ${e.message}` });
        }
      },
    };
    this.actionService.registerAction(installAction);
  }

  private unregisterDetailViewActions(): void {
    if (!this.actionService) return;
    this.logService?.debug("Unregistering store detail view actions...");
    this.actionService.unregisterAction("store-install-current");
  }
  // --- End Action Registration ---


  // Required methods from Extension interface
  async viewActivated(viewPath: string): Promise<void> {
    this.logService?.debug(`Store view activated: ${viewPath}`);
    if (viewPath === `${EXTENSION_ID}/ExtensionDetailView`) {
      this.currentViewIsDetail = true;
      await this.registerDetailViewActions(); // Use await if register is async
    } else {
      // If activating a different view within the same extension, ensure detail actions are removed
      if (this.currentViewIsDetail) {
         this.unregisterDetailViewActions();
         this.currentViewIsDetail = false;
      }
    }
  }

  async viewDeactivated(viewPath: string): Promise<void> {
    this.logService?.debug(`Store view deactivated: ${viewPath}`);
    // Always unregister detail actions when the view deactivates, regardless of which specific view it was
    if (this.currentViewIsDetail) {
        this.unregisterDetailViewActions();
        this.currentViewIsDetail = false;
    }
  }

  onUnload(): void {
    // Ensure actions are unregistered on unload
    this.unregisterDetailViewActions();
    this.logService?.info("Store extension unloading.");
  }

  // Add onViewSearch method
  async onViewSearch(query: string): Promise<void> {
    this.logService?.debug(`Store view search received: "${query}"`);
    storeViewState.setSearch(query); // Update the state store
  }
}

// Export an instance of the class
export default new StoreExtension();
