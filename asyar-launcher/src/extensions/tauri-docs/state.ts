import { writable } from "svelte/store";
import { getDocsByCategory } from "./docSearch";
import type { DocEntry } from "./types/DocEntry";

interface TauriDocsState {
  searchQuery: string;
  searchResults: DocEntry[];
  isSearching: boolean;
  selectedCategory: string | null;
  categories: string[];
}

function createTauriDocsState() {
  const { subscribe, set, update } = writable<TauriDocsState>({
    searchQuery: "",
    searchResults: [],
    isSearching: false,
    selectedCategory: null,
    categories: ["guide", "api"],
  });

  return {
    subscribe,

    setSearchResults(results: DocEntry[], query: string) {
      update((state) => ({
        ...state,
        searchResults: results,
        searchQuery: query,
        isSearching: query.length > 0,
      }));
    },

    setCategory(category: string | null) {
      update((state) => {
        const newState = {
          ...state,
          selectedCategory: category,
          isSearching: false,
          searchQuery: "",
        };

        // If a category is selected, filter results by that category
        if (category) {
          newState.searchResults = getDocsByCategory(category);
        } else {
          newState.searchResults = [];
        }

        return newState;
      });
    },

    reset() {
      set({
        searchQuery: "",
        searchResults: [],
        isSearching: false,
        selectedCategory: null,
        categories: ["guide", "api"],
      });
    },
  };
}

export const tauriDocsState = createTauriDocsState();
