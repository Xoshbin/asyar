import { clipboardViewState } from "./state";
import Fuse from "fuse.js";
import ClipboardHistory from './ClipboardHistory.svelte'; // Import component

import type {
  Extension,
  ExtensionContext,
  ExtensionResult,
  ILogService,
  IExtensionManager,
  IClipboardHistoryService,
  ClipboardHistoryItem,
} from "asyar-api";
import type { ExtensionAction, IActionService } from "asyar-api/dist/types";

// Define static results for clipboard extension
const clipboardResults = [
  {
    id: "clipboard-history",
    title: "Clipboard History",
    subtitle: "View and manage your clipboard history",
    keywords: "clipboard copy paste history",
  },
];

// Fuzzy search options for extension search
const fuseOptions = {
  includeScore: true,
  threshold: 0.4,
  keys: ["title", "subtitle", "keywords"],
};

// Create a Fuse instance for the extension
const fuse = new Fuse(clipboardResults, fuseOptions);

class ClipboardHistoryExtension implements Extension {
  onUnload: any;

  private logService?: ILogService;
  private extensionManager?: IExtensionManager;
  private clipboardService?: IClipboardHistoryService;
  private actionService?: IActionService;
  private inView: boolean = false;
  private context?: ExtensionContext;

  async initialize(context: ExtensionContext): Promise<void> {
    try {
      this.context = context;
      this.logService = context.getService<ILogService>("LogService");
      this.extensionManager =
        context.getService<IExtensionManager>("ExtensionManager");
      this.clipboardService = context.getService<IClipboardHistoryService>(
        "ClipboardHistoryService"
      );
      this.actionService = context.getService<IActionService>("ActionService");

      if (
        !this.logService ||
        !this.extensionManager ||
        !this.clipboardService ||
        !this.actionService
      ) {
        console.error(
          "Failed to initialize required services for Clipboard History"
        );
        this.logService?.error(
          "Failed to initialize required services for Clipboard History"
        );
        return;
      }

      // Initialize state services
      clipboardViewState.initializeServices(context);

      this.logService.info(
        "Clipboard History extension initialized with services"
      );
    } catch (error) {
      console.error("Clipboard History initialization failed:", error);
      this.logService?.error(
        `Clipboard History initialization failed: ${error}`
      );
    }
  }

  async executeCommand(
    commandId: string,
    args?: Record<string, any>
  ): Promise<any> {
    this.logService?.info(`Executing clipboard command: ${commandId}`);

    switch (commandId) {
      case "show-clipboard":
        // Pre-load clipboard items before navigating
        await this.refreshClipboardData(); // Ensure data is loaded before navigating

        this.extensionManager?.navigateToView(
          "clipboard-history/ClipboardHistory"
        );
        // Register action when command is executed
        this.registerViewActions();
        return {
          type: "view",
          viewPath: "clipboard-history/ClipboardHistory",
        };

      default:
        this.logService?.error(`Received unknown command ID: ${commandId}`);
        throw new Error(`Unknown command: ${commandId}`);
    }
  }

  // Called when this extension's view is activated
  async viewActivated(viewPath: string): Promise<void> {
    this.inView = true;
    this.logService?.debug(`Clipboard History view activated: ${viewPath}`);
    // Set the primary action label via the manager
    this.extensionManager?.setActiveViewActionLabel("Paste");
    // Actions are now registered when the command is executed.
    // Refresh data when view is activated (might be redundant if done in executeCommand, but safe)
    await this.refreshClipboardData();
  }

  // Helper method to register view-specific actions
  private registerViewActions() {
    if (!this.actionService || !this.clipboardService) {
      this.logService?.warn(
        "ActionService or ClipboardService not available, cannot register view actions."
      );
      return;
    }
    this.logService?.debug("Registering clipboard view actions...");

    const resetHistoryAction: ExtensionAction = {
      id: "clipboard-reset-history",
      title: "Clear Clipboard History",
      description: "Remove all non-favorite clipboard items",
      icon: "🗑️",
      extensionId: "clipboard-history",
      category: "clipboard-action", // Context is implicitly EXTENSION_VIEW when registered
      execute: async () => {
        try {
          if (
            confirm(
              "Are you sure you want to clear all non-favorite clipboard items?"
            )
          ) {
            // Correct method call
            const success = await this.clipboardService?.clearNonFavorites();
            if (success) {
              this.logService?.info("Non-favorite clipboard history cleared");
            } else {
              this.logService?.warn(
                "Clearing non-favorite clipboard history reported failure."
              );
            }
            // Refresh the view with updated items
            await this.refreshClipboardData(); // Refresh after clearing
          }
        } catch (error) {
          this.logService?.error(`Failed to clear clipboard history: ${error}`);
        }
      },
    };
    // Use registerAction from the service instance
    this.actionService.registerAction(resetHistoryAction);
  }

  // Helper method to unregister view-specific actions
  private unregisterViewActions() {
    if (!this.actionService) {
      this.logService?.warn(
        "ActionService not available, cannot unregister view actions."
      );
      return;
    }
    this.logService?.debug("Unregistering clipboard view actions...");
    // Use unregisterAction from the service instance
    this.actionService.unregisterAction("clipboard-reset-history");
  }

  // Called when this extension's view is deactivated
  async viewDeactivated(viewPath: string): Promise<void> {
    // Unregister actions when the view is deactivated
    this.unregisterViewActions();
    // Clear the primary action label via the manager
    this.extensionManager?.setActiveViewActionLabel(null);
    this.inView = false;
    this.logService?.debug(`Clipboard History view deactivated: ${viewPath}`);
  }

  async onViewSearch(query: string): Promise<void> {
    // Make async
    clipboardViewState.setSearch(query);
  }

  private async refreshClipboardData() {
    if (this.clipboardService) {
      clipboardViewState.setLoading(true);
      try {
        const items = await this.clipboardService.getRecentItems(100);
        clipboardViewState.setItems(items || []); // Ensure items is an array
      } catch (error) {
        this.logService?.error(`Failed to load clipboard data: ${error}`);
        clipboardViewState.setError(`Failed to load clipboard data: ${error}`);
      } finally {
        clipboardViewState.setLoading(false);
      }
    } else {
      this.logService?.warn(
        "ClipboardService not available in refreshClipboardData"
      );
    }
  }

  async activate(): Promise<void> {
    this.logService?.info("Clipboard History extension activated");
  }

  async deactivate(): Promise<void> {
    // Ensure actions are unregistered if the extension is deactivated while view is active
    if (this.inView) {
      this.unregisterViewActions();
    }
    this.logService?.info("Clipboard History extension deactivated");
  }
}

export default new ClipboardHistoryExtension();

// Export component for dynamic loading
export { ClipboardHistory };
