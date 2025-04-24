import { writable, get } from 'svelte/store';
import Fuse from 'fuse.js';
import type { ExtensionContext, ILogService, IExtensionManager } from 'asyar-api'; // Added IExtensionManager

// Re-define ApiExtension here or import if possible (avoiding circular deps)
interface ExtensionAuthor {
  id: number;
  name: string;
}
interface ApiExtension {
  id: number;
  name: string;
  slug: string;
  description: string;
  category: string;
  status: string;
  repository_url: string;
  install_count: number;
  icon_url: string;
  screenshot_urls: string[];
  created_at: string;
  updated_at: string;
  last_polled_at: string | null;
  author: ExtensionAuthor;
}

// Fuzzy search options
const fuseOptions = {
  includeScore: true,
  threshold: 0.4, // Adjust threshold as needed
  keys: ["name", "description", "author.name", "category", "keywords"], // Add keywords if available in ApiExtension
};

export interface StoreViewState {
  searchQuery: string;
  filtered: boolean;
  fuseInstance: Fuse<ApiExtension> | null;
  allItems: ApiExtension[]; // All fetched items
  filteredItems: ApiExtension[]; // Items after filtering
  selectedItem: ApiExtension | null;
  selectedIndex: number;
  isLoading: boolean;
  loadError: boolean;
  errorMessage: string;
  selectedExtensionSlug: string | null; // Keep track of slug for detail view
  extensionManager: IExtensionManager | null; // Store the extension manager instance
  logService: ILogService | null; // Store the log service instance
}

// Note: This function is NOT exported. It's called by initializeStore.
function createStoreViewState() {
  const { subscribe, set, update } = writable<StoreViewState>({
    searchQuery: "",
    filtered: false,
    fuseInstance: null,
    allItems: [],
    filteredItems: [],
    selectedItem: null,
    selectedIndex: -1, // Start with -1 (no selection)
    isLoading: true,
    loadError: false,
    errorMessage: "",
    selectedExtensionSlug: null,
    extensionManager: null, // Initialize as null
    logService: null, // Initialize logService as null
  });

  // Local variables to hold instances, potentially set later
  let logService: ILogService | null = null;
  let extensionManagerInstance: IExtensionManager | null = null;

  // Function to set the log service *after* store creation
  function setLogService(service: ILogService) {
    logService = service;
    update(state => ({ ...state, logService: service }));
    logService?.debug("[Store State] LogService set.");
  }

  // Function to set the extension manager *after* store creation
  function setExtensionManager(manager: IExtensionManager) {
    extensionManagerInstance = manager;
    update(state => ({ ...state, extensionManager: manager }));
    logService?.debug("[Store State] ExtensionManager set.");
  }

  // Deprecated: Services should be set via specific setters now.
  // function initializeServices(context: ExtensionContext) {
  //   logService = context.getService<ILogService>("LogService");
  //   extensionManagerInstance = context.getService<IExtensionManager>("ExtensionManager");
  //   update(state => ({
  //     ...state,
  //     logService: logService ?? null,
  //     extensionManager: extensionManagerInstance ?? null
  //   }));
  // }

  function filterItems(state: StoreViewState): ApiExtension[] {
    if (!state.searchQuery) {
      return state.allItems; // No query, return all items
    }
    if (!state.fuseInstance) {
      logService?.warn("Fuse instance not initialized for search.");
      return state.allItems; // Return all if fuse isn't ready
    }
    // Perform the search
    const results = state.fuseInstance.search(state.searchQuery);
    return results.map(result => result.item); // Return only the items
  }

  return {
    subscribe,
    // initializeServices, // Deprecated
    setLogService, // Expose setter
    setExtensionManager, // Expose setter

    setItems: (items: ApiExtension[]) => {
      logService?.debug(`Store state received ${items.length} items.`);
      update((state) => {
        const newFuseInstance = new Fuse(items, fuseOptions);
        const newState = {
          ...state,
          allItems: items,
          fuseInstance: newFuseInstance,
          isLoading: false,
          loadError: false,
          errorMessage: "",
        };
        // Re-filter based on current query
        newState.filteredItems = filterItems(newState); 
        // Reset selection when items change
        newState.selectedIndex = newState.filteredItems.length > 0 ? 0 : -1; 
        newState.selectedItem = newState.selectedIndex !== -1 ? newState.filteredItems[newState.selectedIndex] : null;
        return newState;
      });
    },

    setSearch: (query: string) => {
      update((state) => {
        const newState = {
          ...state,
          searchQuery: query,
          filtered: query.length > 0,
        };
        newState.filteredItems = filterItems(newState);
        // Reset selection when search query changes
        newState.selectedIndex = newState.filteredItems.length > 0 ? 0 : -1; 
        newState.selectedItem = newState.selectedIndex !== -1 ? newState.filteredItems[newState.selectedIndex] : null;
        return newState;
      });
    },

    moveSelection(direction: "up" | "down") {
      update((state) => {
        if (!state.filteredItems.length) return state; // No items to select

        let newIndex = state.selectedIndex;
        const maxIndex = state.filteredItems.length - 1;

        if (direction === "up") {
          newIndex = newIndex <= 0 ? maxIndex : newIndex - 1;
        } else {
          newIndex = newIndex >= maxIndex ? 0 : newIndex + 1;
        }
        
        return {
          ...state,
          selectedIndex: newIndex,
          selectedItem: state.filteredItems[newIndex],
        };
      });
    },
    
    setSelectedItemByIndex(index: number) {
       update((state) => {
         if (index >= 0 && index < state.filteredItems.length) {
           return {
             ...state,
             selectedIndex: index,
             selectedItem: state.filteredItems[index],
           };
         }
         // If index is out of bounds, potentially reset or keep current
         return { ...state, selectedIndex: -1, selectedItem: null }; 
       });
    },

    setSelectedExtensionSlug(slug: string | null) {
       update(state => ({ ...state, selectedExtensionSlug: slug }));
    },

    setLoading(loading: boolean) {
      update(state => ({ ...state, isLoading: loading }));
    },

    setError(errorMsg: string) {
       update(state => ({ 
         ...state, 
         loadError: true, 
         errorMessage: errorMsg, 
         isLoading: false, 
         allItems: [], 
         filteredItems: []
       }));
    },

    // setLogService is now exposed directly
    // setLogService(service: ILogService) {
    //   update(state => ({ ...state, logService: service }));
    // }
  };
}

// Placeholder for the store instance, initialized on demand
export let storeViewState: ReturnType<typeof createStoreViewState> | null = null;

// Function to initialize the store if it hasn't been already
export function initializeStore() {
  if (!storeViewState) {
    storeViewState = createStoreViewState();
    // Log initialization using the store's own logService if available after creation
    // We need to subscribe and immediately unsubscribe to get the current state
    const unsubscribe = storeViewState.subscribe(state => {
      if (state.logService) {
        state.logService.debug("[Store State] Store initialized on demand.");
      } else {
        // Fallback console log if logService isn't set yet
        console.debug("[Store State] Store initialized on demand (logService not yet available).");
      }
    });
    unsubscribe(); // Unsubscribe immediately
  }
  return storeViewState;
}

// Removed the immediate export:
// export const storeViewState = createStoreViewState();
