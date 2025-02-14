import { GreetingView } from "./components/GreetingView";
import { Extension } from "../../types/Extension";
import { log, commands, ui } from "@asyar/api";
import { Icons } from "../../utils/icons";

const extension: Extension = {
  manifest: null!, // Will be injected by extension loader

  async initialize() {
    log.info("Greeting extension initializing...");
  },

  getSearchResults(query: string) {
    return [
      {
        id: "greeting_view",
        title: "Greetings",
        subtitle: "Click to to go to the greeting view",
        category: "command",
        icon: Icons.CALCULATOR,
        score: 1,
        action: async () => {
          return {
            type: "SET_VIEW",
            view: "extension",
            extensionId: this.manifest.id,
            viewName: "greeting",
          };
        },
      },
    ];
  },

  async getView(viewName: string) {
    if (viewName === "greeting") {
      return GreetingView;
    }
    throw new Error(`View not found: ${viewName}`);
  },
};

export default extension;
