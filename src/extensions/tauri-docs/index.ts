import { tauriDocsState } from "./state";
import { searchDocs } from "./docSearch";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  Extension,
  ExtensionContext,
  ExtensionResult,
  IExtensionManager,
  ILogService,
  INotificationService,
} from "asyar-extension-sdk";

class Alarm implements Extension {
  onUnload: any;
  id = "alarm";
  name = "Alarm";
  version = "1.0.0";

  private logService?: ILogService;
  private extensionManager?: IExtensionManager;

  async initialize(context: ExtensionContext): Promise<void> {
    console.log("Initializing Alarm extension");
    this.extensionManager =
      context.getService<IExtensionManager>("ExtensionManager");
    this.logService = context.getService<ILogService>("LogService");
    this.logService?.info(`${this.name} initialized`);
  }

  async search(query: string): Promise<ExtensionResult[]> {
    const lowerQuery = query.toLowerCase().trim();
    const results: ExtensionResult[] = [];

    // Add view navigation for exact or close matches
    if (
      lowerQuery === "tauri" ||
      lowerQuery === "ta" ||
      lowerQuery === "tau" ||
      lowerQuery === "taur"
    ) {
      results.push(createViewResult(100, this.extensionManager));
    }

    // For partial "ta", "tau" matches, include docs view at lower score
    else if (lowerQuery.startsWith("ta") && lowerQuery.length < 5) {
      results.push(createViewResult(80, this.extensionManager));
    }

    // For "tauri something" searches
    else if (lowerQuery.startsWith("tauri ")) {
      const searchQuery = lowerQuery.substring(6).trim();

      // Always include the view option first
      results.push(createViewResult(100, this.extensionManager));

      // If there's a specific search term, search docs
      if (searchQuery.length > 0) {
        const docResults = await searchDocs(searchQuery);

        // Add top search results
        const searchResults = docResults.slice(0, 5).map((result, index) => ({
          title: result.title,
          subtitle: result.description,
          type: "result" as const,
          action: async () => {
            try {
              // Use the Tauri opener plugin directly to open URLs
              // await this.extensionManager?.window.hide();
              await openUrl(result.url);
            } catch (error) {
              console.error("Error opening URL:", error);
              // Fallback to this.extensionManager? if direct opener fails
              try {
                // await this.extensionManager?.window.hide();
                // await this.extensionManager?.apps.open(result.url);
              } catch (fallbackError) {
                console.error("Fallback also failed:", fallbackError);
              }
            }
          },
          score: 99 - index,
        }));

        results.push(...searchResults);
      }
    }

    // Show option if query contains related terms
    else if (
      ["docs", "api", "documentation"].some((term) => lowerQuery.includes(term))
    ) {
      results.push(createViewResult(60, this.extensionManager));
    }

    return results;
  }

  async onViewSearch(query: string): Promise<void> {
    const results = await searchDocs(query);
    tauriDocsState.setSearchResults(results, query);
  }

  async activate(): Promise<void> {
    this.logService?.info(`${this.name} activated`);
  }

  async deactivate(): Promise<void> {
    this.logService?.info(`${this.name} deactivated`);
  }
}

// Helper function to create the view result consistently
function createViewResult(
  score: number,
  extensionManager: IExtensionManager | undefined
): ExtensionResult {
  return {
    title: "Tauri Documentation",
    subtitle: "Search and browse Tauri documentation",
    type: "view",
    action: () => {
      return extensionManager?.navigateToView("tauri-docs/TauriDocsView");
    },
    score,
  };
}

// Create and export a single instance
export default new Alarm();
