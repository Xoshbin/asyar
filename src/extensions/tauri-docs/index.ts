import { tauriDocsState } from "./state";
import { searchDocs, getDocsByCategory, getCategories } from "./docSearch";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  Extension,
  ExtensionContext,
  ExtensionResult,
  IExtensionManager,
  ILogService,
  INotificationService,
} from "asyar-extension-sdk";
import type {
  ExtensionAction,
  IActionService,
} from "asyar-extension-sdk/dist/types";

class TauriDocsExtension implements Extension {
  onUnload: any;

  private logService?: ILogService;
  private extensionManager?: IExtensionManager;
  private actionService?: IActionService;
  private inView: boolean = false;
  private categoryActions: string[] = [];
  private context?: ExtensionContext;

  async initialize(context: ExtensionContext): Promise<void> {
    this.context = context;
    this.extensionManager =
      context.getService<IExtensionManager>("ExtensionManager");
    this.logService = context.getService<ILogService>("LogService");
    this.actionService = context.getService<IActionService>("ActionService");
    this.logService?.info("Tauri Docs extension initialized");
  }

  // New method to register commands
  async registerCommands(): Promise<void> {
    if (!this.context) {
      this.logService?.error(
        "Cannot register commands - context is not initialized"
      );
      return;
    }

    // Register the search-docs command - for inline search results
    this.context.registerCommand("search-docs", {
      execute: async (args) => {
        const searchQuery = args?.input || "";
        this.logService?.info(
          `Executing search-docs command with query: ${searchQuery}`
        );

        if (searchQuery.trim().length === 0) {
          return {
            type: "view",
            viewPath: "tauri-docs/TauriDocsView",
          };
        }

        // If there's a search query, search the docs and return top results
        const results = await searchDocs(searchQuery);

        if (results.length === 0) {
          return {
            type: "inline",
            displayTitle: "No Tauri documentation found",
            displaySubtitle: `No matches for "${searchQuery}" in the documentation`,
          };
        }

        // Return the top result as an inline result
        const topResult = results[0];
        return {
          type: "inline",
          displayTitle: topResult.title,
          displaySubtitle: `${
            topResult.description
          } (${this.getCategoryDisplayName(topResult.category)})`,
          action: "open-doc-url-action",
          docUrl: topResult.url,
          docEntry: topResult,
          moreResults: results.length > 1,
          resultCount: results.length,
        };
      },
    });

    // Register the show-docs command - for navigating to the view
    this.context.registerCommand("show-docs", {
      execute: async () => {
        this.logService?.info("Executing show-docs command");

        // Pre-load all docs before navigating
        const allDocs = await searchDocs("");
        tauriDocsState.setSearchResults(allDocs, "");

        this.extensionManager?.navigateToView("tauri-docs/TauriDocsView");
        return {
          type: "view",
          viewPath: "tauri-docs/TauriDocsView",
        };
      },
    });

    // Register action handlers
    this.context.registerCommand("open-doc-url-action", {
      execute: async (args) => {
        const url = args?.docUrl;
        if (url) {
          try {
            await openUrl(url);
            return { success: true };
          } catch (error) {
            this.logService?.error(`Failed to open URL: ${error}`);
            return {
              success: false,
              error: String(error),
            };
          }
        }
        return { success: false, error: "No URL provided" };
      },
    });

    this.logService?.info("Tauri Docs commands registered");
  }

  // Execute commands implementation
  async executeCommand(
    commandId: string,
    args?: Record<string, any>
  ): Promise<any> {
    this.logService?.info(
      `Executing command ${commandId} with args: ${JSON.stringify(args || {})}`
    );

    switch (commandId) {
      case "search-docs":
        const searchQuery = args?.input || "";

        if (searchQuery.trim().length === 0) {
          this.extensionManager?.navigateToView("tauri-docs/TauriDocsView");
          return {
            type: "view",
            viewPath: "tauri-docs/TauriDocsView",
          };
        }

        // If there's a search query, search the docs and return top results
        const results = await searchDocs(searchQuery);

        if (results.length === 0) {
          return {
            type: "inline",
            displayTitle: "No Tauri documentation found",
            displaySubtitle: `No matches for "${searchQuery}" in the documentation`,
          };
        }

        // Return the top result as an inline result
        const topResult = results[0];
        return {
          type: "inline",
          displayTitle: topResult.title,
          displaySubtitle: `${
            topResult.description
          } (${this.getCategoryDisplayName(topResult.category)})`,
          action: "open-doc-url-action",
          docUrl: topResult.url,
          docEntry: topResult,
          moreResults: results.length > 1,
          resultCount: results.length,
        };

      case "show-docs":
        // Pre-load all docs before navigating
        const allDocs = await searchDocs("");
        tauriDocsState.setSearchResults(allDocs, "");

        this.extensionManager?.navigateToView("tauri-docs/TauriDocsView");
        return {
          type: "view",
          viewPath: "tauri-docs/TauriDocsView",
        };

      case "open-doc-url-action":
        const url = args?.docUrl;
        if (url) {
          try {
            await openUrl(url);
            return { success: true };
          } catch (error) {
            this.logService?.error(`Failed to open URL: ${error}`);
            return {
              success: false,
              error: String(error),
            };
          }
        }
        return { success: false, error: "No URL provided" };

      default:
        throw new Error(`Unknown command: ${commandId}`);
    }
  }

  // Called when this extension's view is activated
  viewActivated(viewPath: string) {
    this.inView = true;

    if (this.actionService) {
      // Register common actions
      const homepageAction: ExtensionAction = {
        id: "tauri-docs-homepage",
        title: "Tauri Homepage",
        description: "Open the official Tauri homepage",
        icon: "🏠",
        extensionId: "tauri-docs",
        category: "tauri-docs",
        execute: async () => {
          try {
            await openUrl("https://v2.tauri.app/");
          } catch (error) {
            this.logService?.error(`Failed to open Tauri homepage: ${error}`);
          }
        },
      };

      const githubAction: ExtensionAction = {
        id: "tauri-docs-github",
        title: "Tauri GitHub",
        description: "Open Tauri GitHub repository",
        icon: "📂",
        extensionId: "tauri-docs",
        category: "tauri-docs",
        execute: async () => {
          try {
            await openUrl("https://github.com/tauri-apps/tauri");
          } catch (error) {
            this.logService?.error(`Failed to open Tauri GitHub: ${error}`);
          }
        },
      };

      // Register category filter actions
      const categories = getCategories();
      this.categoryActions = []; // Reset category actions

      categories.forEach((category) => {
        const actionId = `tauri-docs-category-${category}`;
        this.categoryActions.push(actionId);

        const categoryAction: ExtensionAction = {
          id: actionId,
          title: `Filter: ${this.getCategoryDisplayName(category)}`,
          description: `Show only ${category} documentation`,
          icon: "🔍",
          extensionId: "tauri-docs",
          category: "filter",
          execute: async () => {
            this.logService?.info(`Filtering docs by category: ${category}`);
            const docs = getDocsByCategory(category);
            tauriDocsState.setCategory(category);
          },
        };

        this.actionService?.registerAction(categoryAction);
      });

      // Register "show all" action
      const showAllAction: ExtensionAction = {
        id: "tauri-docs-show-all",
        title: "Show All Documentation",
        description: "Display all documentation categories",
        icon: "📚",
        extensionId: "tauri-docs",
        category: "filter",
        execute: async () => {
          this.logService?.info("Showing all documentation");
          const docs = await searchDocs("");
          tauriDocsState.setSearchResults(docs, "");
        },
      };

      // Register action to copy current URL
      const copyUrlAction: ExtensionAction = {
        id: "tauri-docs-copy-url",
        title: "Copy Selected Doc URL",
        description: "Copy URL of selected documentation item",
        icon: "📋",
        extensionId: "tauri-docs",
        category: "tauri-docs",
        execute: async () => {
          const selectedItem = tauriDocsState.getCurrentDoc();
          if (selectedItem) {
            try {
              await navigator.clipboard.writeText(selectedItem.url);
              this.logService?.info(`URL copied: ${selectedItem.url}`);
            } catch (error) {
              this.logService?.error(`Failed to copy URL: ${error}`);
            }
          } else {
            this.logService?.info("No documentation item selected");
          }
        },
      };

      // Register all actions
      this.actionService.registerAction(homepageAction);
      this.actionService.registerAction(githubAction);
      this.actionService.registerAction(showAllAction);
      this.actionService.registerAction(copyUrlAction);

      this.logService?.debug("Tauri docs view-specific actions registered");
    }
  }

  // Called when this extension's view is deactivated
  viewDeactivated() {
    // Remove view-specific actions when leaving the view
    if (this.inView && this.actionService) {
      this.actionService.unregisterAction("tauri-docs-homepage");
      this.actionService.unregisterAction("tauri-docs-github");
      this.actionService.unregisterAction("tauri-docs-show-all");
      this.actionService.unregisterAction("tauri-docs-copy-url");

      // Unregister all category actions
      this.categoryActions.forEach((actionId) => {
        this.actionService?.unregisterAction(actionId);
      });
      this.categoryActions = [];

      this.logService?.debug("Tauri docs view-specific actions unregistered");
    }
    this.inView = false;
  }

  // Helper function to get category display name
  private getCategoryDisplayName(category: string): string {
    return category.charAt(0).toUpperCase() + category.slice(1);
  }

  async search(query: string): Promise<ExtensionResult[]> {
    const lowerQuery = query.toLowerCase().trim();
    const results: ExtensionResult[] = [];

    // Add view navigation for exact or close matches
    if (
      lowerQuery === "tauri" ||
      lowerQuery === "ta" ||
      lowerQuery === "tau" ||
      lowerQuery === "taur" ||
      lowerQuery === "docs"
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
              await openUrl(result.url);
            } catch (error) {
              console.error("Error opening URL:", error);
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
    this.logService?.info("Tauri Docs extension activated");
  }

  async deactivate(): Promise<void> {
    // Clean up any registered actions if needed
    if (this.actionService && this.inView) {
      this.actionService.unregisterAction("tauri-docs-homepage");
      this.actionService.unregisterAction("tauri-docs-github");
      this.actionService.unregisterAction("tauri-docs-show-all");
      this.actionService.unregisterAction("tauri-docs-copy-url");

      // Unregister all category actions
      this.categoryActions.forEach((actionId) => {
        this.actionService?.unregisterAction(actionId);
      });
    }

    this.logService?.info("Tauri Docs extension deactivated");
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
export default new TauriDocsExtension();
