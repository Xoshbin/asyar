import { Extension } from "../../types/Extension";
import { log, commands, ui } from "@asyar/api";
import { Icons } from "../../utils/icons";
import { ClipboardView } from "./components/ClipboardView";

const extension: Extension = {
  manifest: null!, // Will be injected by extension loader

  async initialize() {
    log.info("Clipboard extension initializing...");
  },

  getSearchResults(query: string) {
    return [
      {
        id: "clipboard_view",
        title: "Show clipboard history",
        subtitle: "Click to to go to the clipboard view",
        category: "command",
        icon: Icons.CALCULATOR,
        score: 1,
        action: async () => {
          return {
            type: "SET_VIEW",
            view: "extension",
            extensionId: this.manifest.id,
            viewName: "clipboard",
          };
        },
      },
    ];
  },

  async getView(viewName: string) {
    if (viewName === "clipboard") {
      return ClipboardView;
    }
    throw new Error(`View not found: ${viewName}`);
  },
};

export default extension;
