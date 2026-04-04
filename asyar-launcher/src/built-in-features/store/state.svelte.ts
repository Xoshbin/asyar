import { SearchEngine, type ILogService, type IExtensionManager } from 'asyar-sdk';

// Re-define ApiExtension here or import if possible (avoiding circular deps)
export interface ExtensionAuthor {
  id: number;
  name: string;
}

export interface ApiExtension {
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
  manifest?: { platforms?: string[] };
}

// Search Engine handled in StoreViewStateClass

export class StoreViewStateClass {
  searchQuery = $state("");
  private searchEngine = new SearchEngine<ApiExtension>({
    getText: (it) => `${it.name} ${it.description} ${it.author.name} ${it.category}`,
  });
  allItems = $state<ApiExtension[]>([]); // All fetched items
  selectedItem = $state<ApiExtension | null>(null);
  selectedIndex = $state(-1);
  isLoading = $state(true);
  loadError = $state(false);
  errorMessage = $state("");
  selectedExtensionSlug = $state<string | null>(null); // Keep track of slug for detail view
  extensionManager = $state<IExtensionManager | null>(null); // Store the extension manager instance
  logService = $state<ILogService | null>(null); // Store the log service instance
  installingExtensionSlug = $state<string | null>(null);
  uninstallingExtensionSlug = $state<string | null>(null);
  currentPlatform = $state<string>('');

  filtered = $derived(this.searchQuery.length > 0);

  filteredItems = $derived.by(() => {
    const q = this.searchQuery?.trim() ?? '';
    this.searchEngine.setItems(this.allItems);
    return q ? this.searchEngine.search(q) : this.allItems;
  });

  setLogService(service: ILogService) {
    this.logService = service;
    this.logService?.debug("[Store State] LogService set.");
  }

  setExtensionManager(manager: IExtensionManager) {
    this.extensionManager = manager;
    this.logService?.debug("[Store State] ExtensionManager set.");
  }

  setItems(items: ApiExtension[]) {
    const compatible = this.currentPlatform
      ? items.filter(ext => {
          const platforms = ext.manifest?.platforms;
          return !platforms?.length || platforms.includes(this.currentPlatform);
        })
      : items;
    this.logService?.debug(`Store state received ${items.length} items, ${compatible.length} compatible with platform "${this.currentPlatform || 'unknown'}".`);
    this.allItems = compatible;
    this.isLoading = false;
    this.loadError = false;
    this.errorMessage = "";
    
    // Preserve selection if current index is still valid; otherwise reset to first
    if (this.selectedIndex >= 0 && this.selectedIndex < this.filteredItems.length) {
      this.selectedItem = this.filteredItems[this.selectedIndex]; // refresh item data
    } else {
      this.selectedIndex = this.filteredItems.length > 0 ? 0 : -1;
      this.selectedItem = this.selectedIndex !== -1 ? this.filteredItems[this.selectedIndex] : null;
    }
  }

  setSearch(query: string) {
    const queryChanged = this.searchQuery !== query;
    this.searchQuery = query;
    // Only reset selection when the query actually changes, not on every call
    if (queryChanged) {
      this.selectedIndex = this.filteredItems.length > 0 ? 0 : -1;
      this.selectedItem = this.selectedIndex !== -1 ? this.filteredItems[this.selectedIndex] : null;
    }
  }

  moveSelection(direction: "up" | "down") {
    const items = this.filteredItems;
    if (!items.length) return; // No items to select

    let newIndex = this.selectedIndex;
    const maxIndex = items.length - 1;

    if (direction === "up") {
      newIndex = newIndex <= 0 ? maxIndex : newIndex - 1;
    } else {
      newIndex = newIndex >= maxIndex ? 0 : newIndex + 1;
    }

    this.selectedIndex = newIndex;
    this.selectedItem = items[newIndex];
  }

  setSelectedItemByIndex(index: number) {
    if (index >= 0 && index < this.filteredItems.length) {
      this.selectedIndex = index;
      this.selectedItem = this.filteredItems[index];
    } else {
      this.selectedIndex = -1;
      this.selectedItem = null;
    }
  }

  setSelectedExtensionSlug(slug: string | null) {
    this.selectedExtensionSlug = slug;
  }

  setInstallingSlug(slug: string | null) {
    this.installingExtensionSlug = slug;
  }

  setUninstallingSlug(slug: string | null) {
    this.uninstallingExtensionSlug = slug;
  }

  setCurrentPlatform(platform: string) {
    this.currentPlatform = platform;
  }

  setLoading(loading: boolean) {
    this.isLoading = loading;
  }

  setError(errorMsg: string) {
    this.loadError = true;
    this.errorMessage = errorMsg;
    this.isLoading = false;
    this.allItems = [];
  }

  updateItemStatus(slug: string, status: string) {
    this.allItems = this.allItems.map(it => 
      it.slug === slug ? { ...it, status } : it
    );
    
    if (this.selectedItem && this.selectedItem.slug === slug) {
      this.selectedItem = { ...this.selectedItem, status };
    }
  }
}

export const storeViewState = new StoreViewStateClass();

export function initializeStore() {
  return storeViewState;
}
