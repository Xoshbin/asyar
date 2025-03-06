import type { Extension, ExtensionResult } from "../../types/extension";
import { ExtensionApi } from "../../api/extensionApi";
import { clipboardViewState } from "./state";
import Fuse from "fuse.js";

// Define static results for clipboard extension
const clipboardResults = [
  {
    id: "clipboard-history",
    title: "Clipboard History",
    subtitle: "View and manage your clipboard history",
    keywords: "clipboard copy paste history",
  },
];

// Fuzzy search options for extension search
const fuseOptions = {
  includeScore: true,
  threshold: 0.4,
  keys: ["title", "subtitle", "keywords"],
};

// Create a Fuse instance for the extension
const fuse = new Fuse(clipboardResults, fuseOptions);

const extension: Extension = {
  async search(query: string): Promise<ExtensionResult[]> {
    // For empty/short queries or direct prefix match
    if (!query || query.length < 2 || query.toLowerCase().startsWith("clip")) {
      return clipboardResults.map((result) => ({
        title: result.title,
        subtitle: result.subtitle,
        score: 0,
        type: "view",
        action: async () => {
          await ExtensionApi.navigation.setView(
            "clipboard-history",
            "ClipboardHistory"
          );
        },
      }));
    }

    // For more specific queries, use fuzzy search
    const results = fuse.search(query);
    return results.map((result) => ({
      title: result.item.title,
      subtitle: result.item.subtitle,
      score: result.score,
      type: "view",
      action: async () => {
        await ExtensionApi.navigation.setView(
          "clipboard-history",
          "ClipboardHistory"
        );
      },
    }));
  },

  async onViewSearch(query: string) {
    clipboardViewState.setSearch(query);
  },
};

export default extension;
