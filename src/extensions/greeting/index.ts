import type { Extension, ExtensionResult } from "../../types/ExtensionType";
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
          ExtensionApi.log.info("Opening greeting form view");
          await ExtensionApi.navigation.navigateToView(
            "greeting",
            "GreetingView"
          );
        },
        score: 0,
      },
    ];
    return [];
  },
  onUnload: undefined,
};

export default extension;
