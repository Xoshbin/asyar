import { writable, get } from "svelte/store";
import Fuse from "fuse.js";
import type {
  ClipboardHistoryItem,
  IClipboardHistoryService,
  ExtensionContext,
} from "asyar-api";

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
  items: ClipboardHistoryItem[];
  selectedItem: ClipboardHistoryItem | null;
  selectedIndex: number;
  isLoading: boolean;
  loadError: boolean;
  errorMessage: string;
}

function createClipboardViewState() {
  const { subscribe, set, update } = writable<ClipboardViewState>({
    searchQuery: "",
    filtered: false,
    lastSearch: Date.now(),
    fuseInstance: null,
    items: [],
    selectedItem: null,
    selectedIndex: 0,
    isLoading: true,
    loadError: false,
    errorMessage: "",
  });

  // Service references
  let clipboardService: IClipboardHistoryService | undefined;
  let logService: any;

  // Add method to initialize services
  function initializeServices(context: ExtensionContext) {
    clipboardService = context.getService<IClipboardHistoryService>(
      "ClipboardHistoryService"
    );
    logService = context.getService("LogService");
  }

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
        items: [] as ClipboardHistoryItem[],
        selectedItem: null,
        selectedIndex: 0,
        isLoading: true,
        loadError: false,
        errorMessage: "",
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
          items: [] as ClipboardHistoryItem[],
          selectedItem: null,
          selectedIndex: 0,
          isLoading: true,
          loadError: false,
          errorMessage: "",
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
    setItems: (newItems: ClipboardHistoryItem[]) => {
      console.log("Setting items in state:", newItems.length);
      update((state) => ({
        ...state,
        items: newItems,
        fuseInstance: new Fuse(newItems, fuseOptions),
      }));
    },
    setSelectedItem(index: number) {
      update((state) => {
        const items = state.items;
        if (items.length > 0 && index >= 0 && index < items.length) {
          return {
            ...state,
            selectedItem: items[index],
            selectedIndex: index,
          };
        }
        return state;
      });
    },

    moveSelection(direction: "up" | "down") {
      update((state) => {
        const items = state.items;
        if (!items.length) return state;

        let newIndex = state.selectedIndex;
        if (direction === "up") {
          newIndex = newIndex <= 0 ? items.length - 1 : newIndex - 1;
        } else {
          newIndex = newIndex >= items.length - 1 ? 0 : newIndex + 1;
        }

        requestAnimationFrame(() => {
          const element = document.querySelector(`[data-index="${newIndex}"]`);
          element?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        });

        return {
          ...state,
          selectedIndex: newIndex,
          selectedItem: items[newIndex],
        };
      });
    },

    setLoading(isLoading: boolean) {
      update((state) => ({ ...state, isLoading }));
    },

    setError(error: string | null) {
      update((state) => ({
        ...state,
        loadError: !!error,
        errorMessage: error || "",
      }));
    },

    initializeServices,

    async handleItemAction(
      item: ClipboardHistoryItem,
      action: "paste" | "select" | "favorite"
    ) {
      if (!item?.id || !clipboardService) return;

      try {
        switch (action) {
          case "paste":
            await clipboardService.pasteItem(item);
            clipboardService?.hideWindow();
            break;

          case "select":
            const state = get({ subscribe });
            const index = state.items.findIndex((i) => i.id === item.id);
            if (index >= 0) {
              this.setSelectedItem(index);
            }
            break;
        }
      } catch (error) {
        console.error(`Failed to handle item action: ${error}`);
      }
    },

    hideWindow() {
      clipboardService?.hideWindow();
    },

    // Add a new method to refresh history items
    async refreshHistory() {
      this.setLoading(true);
      try {
        if (clipboardService) {
          const items = await clipboardService.getRecentItems(100);
          this.setItems(items);
        }
      } catch (error) {
        console.error(`Failed to refresh clipboard history: ${error}`);
        this.setError(`Failed to refresh clipboard history: ${error}`);
      } finally {
        this.setLoading(false);
      }
    },
  };
}

export const clipboardViewState = createClipboardViewState();
