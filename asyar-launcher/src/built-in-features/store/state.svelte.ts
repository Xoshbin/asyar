import { type ILogService, type IExtensionManager } from 'asyar-sdk/contracts';
import type { AvailableUpdate } from '../../types/ExtensionUpdate';
import { useListSelection } from '../../lib/listSelection.svelte';
import { rankItems } from '../../lib/rankItems';

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
  source?: 'asyar' | 'raycast';
  download_url?: string;
  readme_url?: string;
  manifest?: {
    platforms?: string[];
    permissions?: string[];
    permissionArgs?: Record<string, unknown>;
    runtimes?: string[];
    commands?: ManifestCommand[];
    preferences?: ManifestPreference[];
    readme?: string;
  };
}

export function getInstallCount(item: Partial<ApiExtension> | null | undefined): number {
  if (!item) return 0;
  return item.installCount ?? item.install_count ?? 0;
}

// Search Engine handled in StoreViewStateClass

export class StoreViewStateClass {
  searchQuery = $state('');
  currentSource = $state<'all' | 'asyar' | 'raycast'>('all');
  // Ids of the current search results, best-match first, as ranked by Rust.
  // `null` means no active search (show every fetched item).
  private rankedIds = $state<string[] | null>(null);
  allItems = $state<ApiExtension[]>([]); // All fetched items
  raycastItems = $state<ApiExtension[]>([]); // Raycast store items
  isLoading = $state(true);
  isRaycastLoading = $state(false);
  loadError = $state(false);
  errorMessage = $state('');
  selectedExtensionSlug = $state<string | null>(null); // Keep track of slug for detail view
  extensionManager = $state<IExtensionManager | null>(null); // Store the extension manager instance
  logService = $state<ILogService | null>(null); // Store the log service instance
  installingExtensionSlug = $state<string | null>(null);
  uninstallingExtensionSlug = $state<string | null>(null);
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  filtered = $derived(this.searchQuery.length > 0);

  filteredItems = $derived.by(() => {
    if (this.currentSource === 'raycast') {
      return this.raycastItems;
    }

    const baseItems =
      this.currentSource === 'asyar'
        ? this.allItems.filter((it) => it.source !== 'raycast')
        : this.allItems;

    const q = this.searchQuery?.trim() ?? '';
    if (!q || this.rankedIds === null) return baseItems;
    const byId = new Map(baseItems.map((it) => [String(it.id), it]));
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

  setSource(source: 'all' | 'asyar' | 'raycast') {
    if (this.currentSource === source) return;
    this.currentSource = source;
    this.selection.setIndex(0);
    if (source === 'raycast' && this.raycastItems.length === 0) {
      this.fetchRaycastExtensions(this.searchQuery);
    }
  }

  async fetchRaycastExtensions(query = '') {
    this.isRaycastLoading = true;
    try {
      const q = query.trim();
      const url = `https://backend.raycast.com/api/v1/store_listings/search?q=${encodeURIComponent(q)}&per_page=50`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Raycast/1.0',
          Accept: 'application/json',
        },
      });
      if (!res.ok) {
        throw new Error(`Raycast Store API error: ${res.status}`);
      }
      const data = await res.json();
      const listings = (data.data || data || []) as any[];

      // Check installed extensions to set INSTALLED status accurately
      let installedIds = new Set<string>();
      try {
        const { listInstalledExtensions } = await import('../../lib/ipc/commands');
        const list = (await listInstalledExtensions()) ?? [];
        installedIds = new Set(list.map((p: string) => p.split(/[/\\]/).pop() || p));
      } catch {}

      this.raycastItems = listings.map((l: any): ApiExtension => {
        const extensionId = `org.asyar.raycast.${l.name}`;
        const isInstalled = installedIds.has(extensionId) || installedIds.has(l.name);
        return {
          id: extensionId,
          name: l.title || l.name,
          slug: l.name,
          description: l.description || '',
          category: l.categories?.[0] || 'Raycast',
          status: isInstalled ? 'INSTALLED' : 'NOT_INSTALLED',
          installCount: l.download_count ?? 0,
          iconUrl: l.icons?.light || l.icons?.dark || null,
          source: 'raycast',
          download_url: l.download_url,
          readme_url: l.readme_url,
          author: {
            id: 0,
            name: l.author?.name || l.author?.handle || 'Raycast Contributor',
          },
          manifest: {
            readme: undefined,
            commands: (l.commands || []).map((c: any) => ({
              id: c.name,
              name: c.title,
              description: c.description,
              mode: c.mode === 'view' ? 'view' : 'background',
            })),
          },
        };
      });
    } catch (err: any) {
      this.logService?.warn(`Failed to fetch Raycast extensions: ${err.message}`);
    } finally {
      this.isRaycastLoading = false;
    }
  }

  async setSearch(query: string) {
    if (this.searchQuery === query) return;
    this.searchQuery = query;
    // Re-anchor at the top so the strongest match for the new query is selected.
    this.selection.setIndex(0);

    if (this.currentSource === 'raycast') {
      if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = setTimeout(() => {
        this.fetchRaycastExtensions(query);
      }, 250);
      return;
    }

    const q = query.trim();
    if (!q) {
      this.rankedIds = null;
      return;
    }

    const baseItems =
      this.currentSource === 'asyar'
        ? this.allItems.filter((it) => it.source !== 'raycast')
        : this.allItems;

    const ranked = await rankItems(q, baseItems, {
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
    this.raycastItems = this.raycastItems.map((it) => (it.slug === slug ? { ...it, status } : it));
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
