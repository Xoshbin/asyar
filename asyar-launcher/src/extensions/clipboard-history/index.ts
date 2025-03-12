import { clipboardViewState } from "./state";
import Fuse from "fuse.js";

import type {
  Extension,
  ExtensionContext,
  ExtensionResult,
  ILogService,
  IExtensionManager,
} from "asyar-extension-sdk";
import type { SearchProvider } from "asyar-extension-sdk/dist/types";
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
  onViewSearch?: ((query: string) => Promise<void>) | undefined;
  searchProviders?: SearchProvider[] | undefined;
  id = "clipboard-history";
  name = "Clipboard History";
  version = "1.0.0";

  private logService?: ILogService;
  private extensionManager?: IExtensionManager;

  async initialize(context: ExtensionContext): Promise<void> {
    this.logService = context.getService<ILogService>("LogService");
    this.extensionManager =
      context.getService<IExtensionManager>("ExtensionManager");
    this.logService?.info("Clipboard History extension initialized");
  }

  async search(query: string): Promise<ExtensionResult[]> {
    if (!query.toLowerCase().includes("clip")) return [];

    return [
      {
        title: "Clipboard History testitem",
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

  async activate(): Promise<void> {
    this.logService?.info("Clipboard History extension activated");
  }

  async deactivate(): Promise<void> {
    this.logService?.info("Clipboard History extension deactivated");
  }
}

export default new ClipboardHistoryExtension();
