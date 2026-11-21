import { type ILogService, type IExtensionManager } from 'asyar-sdk/contracts';
import type { AvailableUpdate } from '../../types/ExtensionUpdate';
import { useListSelection } from '../../lib/listSelection.svelte';
import { rankItems } from '../../lib/rankItems';
import { matchesStoreFilter } from './categories';

// Re-define ApiExtension here or import if possible (avoiding circular deps)
export interface ExtensionAuthor {
  id: number;
  name: string;
}

export interface ManifestCommandArgument {
  name: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  default?: string | number | boolean;
}

export interface ManifestCommand {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  mode?: 'view' | 'background' | string;
  component?: string;
  trigger?: string;
  arguments?: ManifestCommandArgument[];
  requireAnyOf?: string[];
  schedule?: {
    intervalSeconds?: number;
  };
  searchable?: boolean;
}

export interface ManifestPreference {
  name: string;
  type: string;
  title?: string;
  description?: string;
  default?: unknown;
  required?: boolean;
}

export interface ApiExtension {
  id: number | string;
  name: string;
  slug: string;
  description: string;
  category: string;
  status: string;
  repository_url?: string;
  repoUrl?: string;
  install_count?: number;
  installCount?: number;
  icon_url?: string | null;
  iconUrl?: string | null;
  screenshot_urls?: string[];
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
  last_polled_at?: string | null;
  author: ExtensionAuthor;
  manifest?: {
    id?: string;
    type?: 'extension' | 'theme' | string;
    platforms?: string[];
    permissions?: string[];
    permissionArgs?: Record<string, unknown>;
    runtimes?: string[];
    commands?: ManifestCommand[];
    preferences?: ManifestPreference[];
    webSearchEngines?: unknown[];
    webReaders?: unknown[];
    aiProviders?: unknown[];
    fileSearchProviders?: unknown[];
  };
}

export function getInstallCount(item: Partial<ApiExtension> | null | undefined): number {
  if (!item) return 0;
  return item.installCount ?? item.install_count ?? 0;
}

// Search Engine handled in StoreViewStateClass

export class StoreViewStateClass {
  searchQuery = $state('');
  categoryFilter = $state<string>('all');
  // Ids of the current search results, best-match first, as ranked by Rust.
  // `null` means no active search (show every fetched item).
  private rankedIds = $state<string[] | null>(null);
  allItems = $state<ApiExtension[]>([]); // All fetched items
  isLoading = $state(true);
  loadError = $state(false);
  errorMessage = $state('');
  selectedExtensionSlug = $state<string | null>(null); // Keep track of slug for detail view
  extensionManager = $state<IExtensionManager | null>(null); // Store the extension manager instance
  logService = $state<ILogService | null>(null); // Store the log service instance
  installingExtensionSlug = $state<string | null>(null);
  uninstallingExtensionSlug = $state<string | null>(null);

  filtered = $derived(this.searchQuery.length > 0 || this.categoryFilter !== 'all');

  filteredItems = $derived.by(() => {
    const q = this.searchQuery?.trim() ?? '';
    let base: ApiExtension[];
    if (!q || this.rankedIds === null) {
      base = this.allItems;
    } else {
      const byId = new Map(this.allItems.map((it) => [String(it.id), it]));
      base = this.rankedIds
        .map((id) => byId.get(id))
        .filter((it): it is ApiExtension => it !== undefined);
    }
    if (this.categoryFilter === 'all') return base;
    return base.filter((it) => matchesStoreFilter(it, this.categoryFilter));
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
    this.logService?.debug('[Store State] LogService set.');
  }

  setExtensionManager(manager: IExtensionManager) {
    this.extensionManager = manager;
    this.logService?.debug('[Store State] ExtensionManager set.');
  }

  setItems(items: ApiExtension[]) {
    this.logService?.debug(`Store state received ${items.length} items.`);
    this.allItems = items;
    this.isLoading = false;
    this.loadError = false;
    this.errorMessage = '';
  }

  setCategoryFilter(filter: string) {
    const next = filter || 'all';
    if (this.categoryFilter === next) return;
    this.categoryFilter = next;
    this.selection.setIndex(0);
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

  moveSelection(direction: 'up' | 'down') {
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
    this.allItems = this.allItems.map((it) => (it.slug === slug ? { ...it, status } : it));
  }

  applyUpdateStatus(updates: AvailableUpdate[]): void {
    const updateMap = new Map(updates.map((u) => [u.extensionId, u]));
    this.allItems = this.allItems.map((item) => {
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
