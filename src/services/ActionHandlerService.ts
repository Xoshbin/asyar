import { ActionResult } from "../types";
import { pluginManager } from "./pluginManagerInstance";
import { api } from "../api";
import SearchManager from "./searchManager";
import panelManager from "./panelManager";

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
              api.system.log.error(
                `Failed to execute application action: ${error}`
              );
              return { type: "NONE" };
            }
          }

          // For non-application items, execute action normally
          return item.action();
        }
      }

      // Try plugin results if not found in search
      try {
        const pluginResults = await pluginManager.search(title);
        const pluginItem = pluginResults.find(
          (item) => item.title === title && item.category === itemCategory
        );

        if (pluginItem) {
          return pluginItem.action();
        }
      } catch (error) {
        api.system.log.error(`Plugin search error: ${error}`);
      }

      return { type: "NONE" };
    } catch (error) {
      api.system.log.error(`Action execution error: ${error}`);
      return { type: "NONE" };
    }
  }
}
