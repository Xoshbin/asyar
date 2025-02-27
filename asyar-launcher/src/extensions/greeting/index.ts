import type { Extension, ExtensionResult } from "../../types/extension";
import extensionManager from "../../services/extensionManager";
import { LogService } from "../../services/logService";
import { ExtensionApi } from "../../api/extensionApi";

const extension: Extension = {
  async search(query: string): Promise<ExtensionResult[]> {
    return [
      {
        title: "Greeting Form",
        subtitle: "Open greeting form to get a personalized welcome",
        type: "view",
        viewPath: "greeting/GreetingView", // Make sure this matches exactly
        action: async () => {
          LogService.info("Opening greeting form view");
          await ExtensionApi.navigation.setView("greeting", "GreetingView");
        },
        score: 0,
      },
    ];
    return [];
  },
};

export default extension;
