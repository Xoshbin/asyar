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

    // Expose clipboardService methods through the state store
    async clearNonFavorites() {
      if (!clipboardService) {
        logService?.error("Clipboard service not initialized in clearNonFavorites");
        return false;
      }
      try {
        return await clipboardService.clearNonFavorites();
      } catch (error) {
        logService?.error(`Error clearing non-favorites: ${error}`);
        return false;
      }
    },

    async toggleFavorite(itemId: string) {
      if (!clipboardService) {
        logService?.error("Clipboard service not initialized in toggleFavorite");
        return false;
      }
      try {
        // Correct the method name based on the TS error suggestion
        return await clipboardService.toggleItemFavorite(itemId);
      } catch (error) {
        logService?.error(`Error toggling favorite for ${itemId}: ${error}`);
        return false;
      }
    },
    // --- End exposed methods ---

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
        logService?.error(`Failed to handle item action: ${error}`); // Use logService
      }
    },

    // Renamed from hideWindow for clarity, calls service method
    async hidePanel() {
       if (!clipboardService) {
         logService?.error("Clipboard service not initialized in hidePanel");
         return;
       }
       try {
         await clipboardService.hideWindow();
       } catch (error) {
         logService?.error(`Error hiding window: ${error}`);
       }
    },

    // Refresh history items (no change needed here, already uses service)
    async refreshHistory() {
      update(state => ({ ...state, isLoading: true })); // Use update instead of this.setLoading
      try {
        if (clipboardService) {
          const items = await clipboardService.getRecentItems(100);
          update(state => ({ // Use update instead of this.setItems
            ...state,
            items: items,
            fuseInstance: new Fuse(items, fuseOptions), // Update fuse instance too
          }));
        } else {
            logService?.warn("Clipboard service not available in refreshHistory");
        }
      } catch (error) {
        logService?.error(`Failed to refresh clipboard history: ${error}`); // Use logService
        update(state => ({ // Use update instead of this.setError
             ...state,
             loadError: true,
             errorMessage: `Failed to refresh clipboard history: ${error}`
        }));
      } finally {
        this.setLoading(false);
      }
    },
  };
}

export const clipboardViewState = createClipboardViewState();
