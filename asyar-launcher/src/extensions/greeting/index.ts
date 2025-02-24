import type { Extension, ExtensionResult } from "../../types/extension";
import extensionManager from "../../services/extensionManager";
import { LogService } from "../../services/logService";

const extension: Extension = {
  async search(query: string): Promise<ExtensionResult[]> {
    if (query.toLowerCase().startsWith("gr")) {
      LogService.debug("Greeting extension matched query");
      return [
        {
          title: "Greeting Form",
          subtitle: "Open greeting form to get a personalized welcome",
          type: "view",
          viewPath: "greeting/GreetingView", // Make sure this matches exactly
          action: () => {
            LogService.info("Opening greeting form view");
            extensionManager.navigateToView("greeting/GreetingView");
          },
        },
      ];
    }
    return [];
  },
};

export default extension;
