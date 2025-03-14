import { clipboardViewState } from "./state";
import Fuse from "fuse.js";

import type {
  Extension,
  ExtensionContext,
  ExtensionResult,
  ILogService,
  IExtensionManager,
  IClipboardHistoryService,
} from "asyar-extension-sdk";
import type {
  ExtensionAction,
  IActionService,
} from "asyar-extension-sdk/dist/types";

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
  id = "clipboard-history";
  name = "Clipboard History";
  version = "1.0.0";

  private logService?: ILogService;
  private extensionManager?: IExtensionManager;
  private clipboardService?: IClipboardHistoryService;
  private actionService?: IActionService;
  private inView: boolean = false;

  async initialize(context: ExtensionContext): Promise<void> {
    try {
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
        !this.clipboardService
      ) {
        console.error("Failed to initialize required services");
        return;
      }

      // Initialize state services
      clipboardViewState.initializeServices(context);

      this.logService.info(
        "Clipboard History extension initialized with services"
      );
    } catch (error) {
      console.error("Extension initialization failed:", error);
    }
  }

  // Called when this extension's view is activated
  viewActivated(viewPath: string) {
    this.inView = true;

    // Register view-specific actions
    if (this.actionService && this.clipboardService) {
      // Reset clipboard history action
      const resetHistoryAction: ExtensionAction = {
        id: "clipboard-reset-history",
        title: "Clear Clipboard History",
        description: "Remove all non-favorite clipboard items",
        icon: "🗑️",
        extensionId: this.id,
        category: "clipboard-action",
        execute: async () => {
          try {
            if (
              confirm(
                "Are you sure you want to clear all non-favorite clipboard items?"
              )
            ) {
              await this.clipboardService?.clearHistory();
              this.logService?.info("Clipboard history cleared");

              // Refresh the view with updated items
              const items = await this.clipboardService?.getRecentItems(100);
              clipboardViewState.setItems(items || []);
            }
          } catch (error) {
            this.logService?.error(
              `Failed to clear clipboard history: ${error}`
            );
          }
        },
      };

      this.actionService.registerAction(resetHistoryAction);
      this.logService?.debug(
        "Clipboard History view-specific actions registered"
      );
    }
  }

  // Called when this extension's view is deactivated
  viewDeactivated() {
    // Remove view-specific actions when leaving the view
    if (this.inView && this.actionService) {
      this.actionService.unregisterAction("clipboard-reset-history");
      this.logService?.debug(
        "Clipboard History view-specific actions unregistered"
      );
    }
    this.inView = false;
  }

  async search(query: string): Promise<ExtensionResult[]> {
    try {
      // Pre-fetch data before returning results
      if (this.clipboardService) {
        const items = await this.clipboardService.getRecentItems(100);
        this.logService?.info(`Pre-loaded ${items.length} clipboard items`);
        clipboardViewState.setItems(items);
      }

      // Return search results
      if (
        !query ||
        query.length < 2 ||
        query.toLowerCase().startsWith("clip")
      ) {
        return [
          {
            title: "Clipboard History",
            subtitle: "View and manage clipboard history",
            type: "view",
            viewPath: "clipboard-history/ClipboardHistory",
            action: () => {
              this.logService?.info("Opening clipboard history view");
              this.extensionManager?.navigateToView(
                "clipboard-history/ClipboardHistory"
              );
            },
            score: 1,
          },
        ];
      }

      // For more specific queries, use fuzzy search
      const results = fuse.search(query);
      return results.map((result) => ({
        title: `${result.item.title} historyxxx`,
        subtitle: result.item.subtitle,
        score: result.score ?? 1,
        type: "view",
        action: async () => {
          // Pre-fetch data before navigation
          if (this.clipboardService) {
            const items = await this.clipboardService.getRecentItems(100);
            // Store items in state for view to access
            clipboardViewState.setItems(items);
          }
          await this.extensionManager?.navigateToView(
            "clipboard-history/ClipboardHistory"
          );
        },
      }));
    } catch (error) {
      this.logService?.error(`Failed to load clipboard items: ${error}`);
      return [];
    }
  }

  async onViewSearch(query: string) {
    clipboardViewState.setSearch(query);
  }

  async activate(): Promise<void> {
    this.logService?.info("Clipboard History extension activated");
  }

  async deactivate(): Promise<void> {
    // Clean up any registered actions
    if (this.actionService && this.inView) {
      this.actionService.unregisterAction("clipboard-reset-history");
    }

    this.logService?.info("Clipboard History extension deactivated");
  }
}

export default new ClipboardHistoryExtension();
