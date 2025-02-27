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
    if (
      query.toLowerCase().startsWith("clip") ||
      query.toLowerCase().startsWith("c")
    ) {
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

    // For other queries, use fuzzy search if query is substantial
    if (query.length > 1) {
      const results = fuse.search(query);
      if (results.length > 0) {
        return results.map((result) => ({
          title: result.item.title,
          subtitle: result.item.subtitle,
          score: result.score || 0,
          type: "view",
          action: async () => {
            await ExtensionApi.navigation.setView(
              "clipboard-history",
              "ClipboardHistory"
            );
          },
        }));
      }
    }

    return [];
  },

  async onViewSearch(query: string) {
    clipboardViewState.setSearch(query);
  },

  searchProviders: [
    {
      async getAll() {
        return clipboardResults.map((result) => ({
          ...result,
          type: "view",
          action: async () => {
            await ExtensionApi.navigation.setView(
              "clipboard-history",
              "ClipboardHistory"
            );
          },
        }));
      },
    },
  ],
};

export default extension;
