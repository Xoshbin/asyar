import type { Extension, ExtensionResult } from "../../types/extension";
import { ExtensionApi } from "../../api/extensionApi";
import { clipboardViewState } from "./state";

const extension: Extension = {
  async search(query: string): Promise<ExtensionResult[]> {
    if (query.toLowerCase().startsWith("cl")) {
      return [
        {
          title: "Clipboard History",
          subtitle: "View and manage your clipboard history",
          type: "view",
          action: async () => {
            await ExtensionApi.navigation.setView(
              "clipboard-history",
              "ClipboardHistory"
            );
          },
        },
      ];
    }
    return [];
  },

  async onViewSearch(query: string) {
    clipboardViewState.setSearch(query);
  },
};

export default extension;
