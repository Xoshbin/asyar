import { clipboardViewState } from "./state";
import Fuse from "fuse.js";

import type {
  Extension,
  ExtensionContext,
  ExtensionResult,
  ILogService,
  IExtensionManager,
} from "asyar-extension-sdk";
import type { IClipboardHistoryService } from "asyar-extension-sdk";

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

  async initialize(context: ExtensionContext): Promise<void> {
    try {
      this.logService = context.getService<ILogService>("LogService");
      this.extensionManager =
        context.getService<IExtensionManager>("ExtensionManager");
      this.clipboardService = context.getService<IClipboardHistoryService>(
        "ClipboardHistoryService"
      );

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
    this.logService?.info("Clipboard History extension deactivated");
  }
}

export default new ClipboardHistoryExtension();
