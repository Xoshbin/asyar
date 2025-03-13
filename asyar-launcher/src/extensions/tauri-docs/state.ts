import { writable } from "svelte/store";
import { getDocsByCategory } from "./docSearch";
import type { DocEntry } from "./types/DocEntry";

interface TauriDocsState {
  searchQuery: string;
  searchResults: DocEntry[];
  isSearching: boolean;
  selectedCategory: string | null;
  categories: string[];
  selectedDoc: DocEntry | null;
}

function createTauriDocsState() {
  const { subscribe, set, update } = writable<TauriDocsState>({
    searchQuery: "",
    searchResults: [],
    isSearching: false,
    selectedCategory: null,
    categories: ["guide", "api"],
    selectedDoc: null,
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

    selectDoc(doc: DocEntry | null) {
      update((state) => ({
        ...state,
        selectedDoc: doc,
      }));
    },

    getCurrentDoc(): DocEntry | null {
      let currentDoc: DocEntry | null = null;

      // Use a temporary subscription to get the current state
      const unsubscribe = subscribe((state) => {
        currentDoc = state.selectedDoc;
      });
      unsubscribe();

      return currentDoc;
    },

    reset() {
      set({
        searchQuery: "",
        searchResults: [],
        isSearching: false,
        selectedCategory: null,
        categories: ["guide", "api"],
        selectedDoc: null,
      });
    },
  };
}

export const tauriDocsState = createTauriDocsState();
