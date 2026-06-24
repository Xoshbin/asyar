import { type ILogService, type IExtensionManager } from 'asyar-sdk/contracts';
import type { AvailableUpdate } from '../../types/ExtensionUpdate';
import { useListSelection } from '../../lib/listSelection.svelte';
import { rankItems } from '../../lib/rankItems';

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
  // Ids of the current search results, best-match first, as ranked by Rust.
  // `null` means no active search (show every fetched item).
  private rankedIds = $state<string[] | null>(null);
  allItems = $state<ApiExtension[]>([]); // All fetched items
  isLoading = $state(true);
  loadError = $state(false);
  errorMessage = $state("");
  selectedExtensionSlug = $state<string | null>(null); // Keep track of slug for detail view
  extensionManager = $state<IExtensionManager | null>(null); // Store the extension manager instance
  logService = $state<ILogService | null>(null); // Store the log service instance
  installingExtensionSlug = $state<string | null>(null);
  uninstallingExtensionSlug = $state<string | null>(null);

  filtered = $derived(this.searchQuery.length > 0);

  filteredItems = $derived.by(() => {
    const q = this.searchQuery?.trim() ?? '';
    if (!q || this.rankedIds === null) return this.allItems;
    const byId = new Map(this.allItems.map((it) => [String(it.id), it]));
    return this.rankedIds
      .map((id) => byId.get(id))
      .filter((it): it is ApiExtension => it !== undefined);
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
    this.logService?.debug(`Store state received ${items.length} items.`);
    this.allItems = items;
    this.isLoading = false;
    this.loadError = false;
    this.errorMessage = "";
  }

  async setSearch(query: string) {
    if (this.searchQuery === query) return;
    this.searchQuery = query;
    // Re-anchor at the top so the strongest match for the new query is selected.
    this.selection.setIndex(0);

    const q = query.trim();
    if (!q) {
      this.rankedIds = null;
      return;
    }

    const ranked = await rankItems(q, this.allItems, {
      id: (it) => String(it.id),
      title: (it) => it.name,
      subtitle: (it) => it.description,
      keywords: (it) => [it.author.name, it.category],
    });

    // Guard against out-of-order responses from rapid typing.
    if (this.searchQuery.trim() !== q) return;
    this.rankedIds = ranked.map((it) => String(it.id));
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
