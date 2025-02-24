import type { Extension, ExtensionResult } from "../../types/extension";
import { ClipboardHistoryService } from "../../services/ClipboardHistoryService";
import extensionManager from "../../services/extensionManager";

const clipboardService = new ClipboardHistoryService();

const extension: Extension = {
  async search(query: string): Promise<ExtensionResult[]> {
    if (query.toLowerCase().startsWith("cl")) {
      return [
        {
          title: "Clipboard History",
          subtitle: "View and manage your clipboard history",
          type: "view",
          viewPath: "clipboard-history/ClipboardHistory",
          action: () => {
            extensionManager.navigateToView(
              "clipboard-history/ClipboardHistory"
            );
          },
        },
      ];
    }
    return [];
  },
};

export default extension;
