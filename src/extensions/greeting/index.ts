import type {
  Extension,
  ExtensionManifest,
  ExtensionResult,
} from "../../types/extension";
import extensionManager from "../../services/extensionManager";
import { LogService } from "../../services/logService";
import manifest from "./manifest.json";

const extension: Extension = {
  manifest: manifest as ExtensionManifest,
  async search(query: string): Promise<ExtensionResult[]> {
    LogService.debug(`Greeting extension searching: "${query}"`);
    if (query.toLowerCase().startsWith("gr")) {
      LogService.debug("Greeting extension matched query");
      return [
        {
          title: "Greeting Form",
          subtitle: "Open greeting form to get a personalized welcome",
          type: "view",
          viewPath: "greeting",
          action: () => {
            LogService.info("Opening greeting form view");
            extensionManager.navigateToView("greeting");
          },
        },
      ];
    }
    return [];
  },
};

export default extension;
