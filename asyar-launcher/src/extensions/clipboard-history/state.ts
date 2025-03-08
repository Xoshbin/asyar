import { writable } from "svelte/store";
import Fuse from "fuse.js";
import type { ClipboardHistoryItem } from "../../types/ClipboardType";

// Fuzzy search options
const fuseOptions = {
  includeScore: true,
  threshold: 0.4,
  keys: ["content"],
};

interface ClipboardViewState {
  searchQuery: string;
  filtered: boolean;
  lastSearch: number;
  fuseInstance: Fuse<ClipboardHistoryItem> | null;
}

function createClipboardViewState() {
  const { subscribe, set, update } = writable<ClipboardViewState>({
    searchQuery: "",
    filtered: false,
    lastSearch: Date.now(),
    fuseInstance: null,
  });

  return {
    subscribe,
    setSearch: (query: string) =>
      update((state) => ({
        ...state,
        searchQuery: query,
        filtered: query.length > 0,
        lastSearch: Date.now(),
      })),
    reset: () =>
      set({
        searchQuery: "",
        filtered: false,
        lastSearch: Date.now(),
        fuseInstance: null,
      }),
    initFuse: (items: ClipboardHistoryItem[]) =>
      update((state) => ({
        ...state,
        fuseInstance: new Fuse(items, fuseOptions),
      })),
    search: (items: ClipboardHistoryItem[], query: string) => {
      let result = items;

      if (query && query.trim() !== "") {
        // Initialize with a default state structure
        let currentState: ClipboardViewState = {
          searchQuery: query,
          filtered: true,
          lastSearch: Date.now(),
          fuseInstance: null,
        };

        // Get the current state safely using a temporary subscription
        const unsubscribe = subscribe((state) => {
          currentState = state;
        });
        unsubscribe();

        // Initialize fuse with proper type
        let fuse: Fuse<ClipboardHistoryItem>;

        // Create or update Fuse instance if needed
        if (!currentState.fuseInstance) {
          fuse = new Fuse(items, fuseOptions);
        } else {
          fuse = currentState.fuseInstance;
          // Update the collection if it might have changed
          fuse.setCollection(items);
        }

        // Perform the search
        const searchResults = fuse.search(query);
        result = searchResults.map((res) => ({
          ...res.item,
          score: res.score,
        }));

        // Update the state with the Fuse instance
        update((state) => ({
          ...state,
          fuseInstance: fuse,
        }));
      }

      return result;
    },
  };
}

export const clipboardViewState = createClipboardViewState();
