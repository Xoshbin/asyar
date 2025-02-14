import MacOSAppService from "./applications";
import { commandRegistry } from "./commandRegistry";
import { extensionManager } from "./extensionManagerInstance";
import type { SearchResults, SearchResultItem } from "../types";
import { IconName, Icons } from "../utils/icons";

class SearchManager {
  private readonly commandResults: SearchResultItem[] = [
    {
      id: "clipboard",
      title: "Show Clipboard History",
      subtitle: "View and paste from recent clipboard items",
      category: "command",
      icon: Icons.CLIPBOARD,
      score: 1,
      action: async () => {
        return { type: "SET_VIEW", view: "clipboard" };
      },
      metadata: {
        viewTransition: "clipboard",
      },
    },
    // Add more commands here
  ];

  async search(query: string): Promise<SearchResults> {
    if (!query.trim()) {
      return { categories: [] };
    }

    const categories = [];
    const lowercaseQuery = query.toLowerCase();

    // Handle special commands first
    if (lowercaseQuery === "cl") {
      const clipboardCategory = {
        name: "Commands",
        items: [this.commandResults[0]], // Clipboard command
        category: "command",
        title: "Commands",
      };
      categories.push(clipboardCategory);
    }

    // Search for applications that match the query
    const apps = await MacOSAppService.search(query);
    const matchingApps = apps.filter((app) =>
      this.fuzzyMatch(app.name.toLowerCase(), lowercaseQuery)
    );

    if (matchingApps.length > 0) {
      categories.push({
        name: "Applications",
        items: matchingApps.map((app) => ({
          id: app.path,
          title: app.name,
          category: "application",
          icon: this.getAppIcon(app.name),
          score: this.calculateScore(app.name.toLowerCase(), lowercaseQuery),
          action: async () => {
            await MacOSAppService.open(app);
          },
        })),
        category: "application",
        title: "Applications",
      });
    }

    // Search for commands that match the query
    const matchingCommands = this.commandResults.filter((cmd) =>
      this.fuzzyMatch(cmd.title.toLowerCase(), lowercaseQuery)
    );

    if (matchingCommands.length > 0) {
      categories.push({
        name: "Commands",
        items: matchingCommands,
        category: "command",
        title: "Commands",
      });
    }

    // Get extension search results
    const extensionResults = await this.getExtensionResults(query);
    if (extensionResults.length > 0) {
      categories.push({
        name: "Extensions",
        items: extensionResults,
        category: "extension",
        title: "Extensions",
      });
    }

    // Sort categories by relevance
    return {
      categories: categories.map((category) => ({
        ...category,
        category: category.category as "application" | "command" | "extension",
        items: category.items.sort((a, b) => (b.score || 0) - (a.score || 0)),
      })),
    } as SearchResults;
  }

  private fuzzyMatch(str: string, query: string): boolean {
    let queryIndex = 0;
    for (let i = 0; i < str.length && queryIndex < query.length; i++) {
      if (str[i] === query[queryIndex]) {
        queryIndex++;
      }
    }
    return queryIndex === query.length;
  }

  private calculateScore(str: string, query: string): number {
    if (str === query) return 1;
    if (str.startsWith(query)) return 0.8;
    if (str.includes(query)) return 0.6;
    return this.fuzzyMatch(str, query) ? 0.4 : 0;
  }

  private async getExtensionResults(
    query: string
  ): Promise<SearchResultItem[]> {
    const results: SearchResultItem[] = [];
    for (const [, extension] of extensionManager.getLoadedExtensions()) {
      if (extension.getSearchResults) {
        const extensionResults = await extension.getSearchResults(query);
        if (extensionResults) {
          results.push(...extensionResults);
        }
      }
    }
    return results;
  }

  private getAppIcon(appName: string): IconName {
    const iconMap: Record<string, IconName> = {
      Safari: Icons.BROWSER,
      Calculator: Icons.CALCULATOR,
      Calendar: Icons.CALENDAR,
      Messages: Icons.MESSAGES,
      Mail: Icons.MAIL,
      Maps: Icons.MAPS,
      Notes: Icons.NOTES,
      Photos: Icons.PHOTOS,
      Settings: Icons.SETTINGS,
      Terminal: Icons.TERMINAL,
      TextEdit: Icons.TEXT_EDITOR,
    };

    return iconMap[appName] || Icons.APP;
  }
}

export default new SearchManager();
