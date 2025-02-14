import { ActionResult } from "../types";
import SearchManager from "./searchManager";
import panelManager from "./panelManager";
import { log } from "../api/services/log";
import { extensionManager } from "./extensionManagerInstance";

export class ActionHandlerService {
  constructor(private store: any) {}

  async executeAction(
    title: string,
    itemCategory: string
  ): Promise<ActionResult> {
    try {
      // Special handling for clipboard view
      if (itemCategory === "clipboard") {
        return { type: "SET_VIEW", view: "clipboard" };
      }

      // Get raw search results directly from SearchManager
      const searchResults = await SearchManager.search(title);
      const targetCategory = searchResults.categories.find((cat) =>
        cat.items.some(
          (item) => item.title === title && item.category === itemCategory
        )
      );

      if (targetCategory) {
        const item = targetCategory.items.find(
          (item) => item.title === title && item.category === itemCategory
        );

        if (item) {
          if (itemCategory === "application") {
            try {
              // Hide window using panelManager
              await panelManager.hide();
              const result = await item.action();
              return { type: "NONE" };
            } catch (error) {
              log.error(`Failed to execute application action: ${error}`);
              return { type: "NONE" };
            }
          }

          // For non-application items, execute action normally
          return item.action();
        }
      }

      // Try extension results if not found in search
      try {
        const extensionResults = await extensionManager.search(title);
        const extensionItem = extensionResults.find(
          (item) => item.title === title && item.category === itemCategory
        );

        if (extensionItem) {
          return extensionItem.action();
        }
      } catch (error) {
        log.error(`Extension search error: ${error}`);
      }

      return { type: "NONE" };
    } catch (error) {
      log.error(`Action execution error: ${error}`);
      return { type: "NONE" };
    }
  }
}
