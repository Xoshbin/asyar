import { SearchEngine, type ILogService, type IExtensionManager } from 'asyar-sdk/contracts';
import type { AvailableUpdate } from '../../types/ExtensionUpdate';
import { useListSelection } from '../../lib/listSelection.svelte';

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

  private selection = useListSelection({ items: () => this.filteredItems });

  get selectedIndex(): number {
    return this.selection.selectedIndex;
  }

  get selectedItem(): ApiExtension | null {
    return this.selection.selectedItem;
  }

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
  }

  setSearch(query: string) {
    if (this.searchQuery === query) return;
    this.searchQuery = query;
    // Re-anchor at the top so the strongest match for the new query is selected.
    this.selection.setIndex(0);
  }

  moveSelection(direction: "up" | "down") {
    this.selection.moveSelection(direction);
  }

  setSelectedItemByIndex(index: number) {
    this.selection.setIndex(index);
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
  }

  applyUpdateStatus(updates: AvailableUpdate[]): void {
    const updateMap = new Map(updates.map(u => [u.extensionId, u]));
    this.allItems = this.allItems.map(item => {
      if (item.status === 'INSTALLED' && updateMap.has(String(item.id))) {
        return { ...item, status: 'UPDATE_AVAILABLE' };
      }
      return item;
    });
  }
}

export const storeViewState = new StoreViewStateClass();

export function initializeStore() {
  return storeViewState;
}
