import { searchStores } from '../../services/search/stores/search.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { searchOrchestrator } from '../../services/search/searchOrchestrator.svelte';
import {
  contextModeService,
  type ActiveContext,
  type ContextHint,
  type ContextChipProps,
  type ContextHintProps
} from '../../services/context/contextModeService.svelte';
import { shortcutStore, type ItemShortcut } from '../../built-in-features/shortcuts/shortcutStore.svelte';
import type { SearchResult } from '../../services/search/interfaces/SearchResult';
import type { MappedSearchItem } from '../../services/search/types/MappedSearchItem';
import type BottomActionBar from '../../components/layout/BottomActionBar.svelte';

export class LauncherState {
  // Core reactive state
  localSearchValue = $state(searchStores.query);
  contextQuery = $state('');
  assignShortcutTarget = $state<SearchResult | null>(null);
  assignAliasTarget = $state<SearchResult | null>(null);
  lastActiveViewId = $state<string | null>(null);
  searchResultItemsMapped = $state<MappedSearchItem[]>([]);
  currentSelectedItemOriginal = $state<SearchResult | null>(null);

  // Synced values from services (using $derived where possible)
  activeViewVal = $derived(viewManager.activeView);
  activeViewSearchableVal = $derived(viewManager.activeViewSearchable);
  isSearchLoadingVal = $derived(searchStores.isLoading);
  selectedIndexVal = $derived(searchStores.selectedIndex);
  
  // Directly use contextModeService properties
  contextActivationIdVal = $derived(contextModeService.contextActivationId);
  activeContext = $derived(contextModeService.activeContext);
  contextHint = $derived(contextModeService.contextHint);

  // Search items from orchestrator
  searchItems = $derived(searchOrchestrator.items);
  
  // Shortcuts
  shortcuts = $derived(shortcutStore.shortcuts);

  // Derived chips for SearchHeader
  activeContextChip = $derived<ContextChipProps | null>(this.activeContext
    ? { 
        id: this.activeContext.provider.id, 
        name: this.activeContext.provider.display.name, 
        icon: this.activeContext.provider.display.icon, 
        color: this.activeContext.provider.display.color 
      }
    : null);

  contextHintChip = $derived<ContextHintProps | null>(this.contextHint
    ? { 
        id: this.contextHint.provider.id, 
        name: this.contextHint.provider.display.name, 
        icon: this.contextHint.provider.display.icon, 
        type: this.contextHint.type 
      }
    : null);

  // DOM refs
  #searchInputRef = $state<HTMLInputElement | null>(null);
  #listContainerRef = $state<HTMLDivElement | undefined>(undefined);
  #bottomBarRef: BottomActionBar | undefined;

  setSearchInput(el: HTMLInputElement | null) { this.#searchInputRef = el; }
  setListContainer(el: HTMLDivElement | undefined) { this.#listContainerRef = el; }
  setBottomBar(bar: BottomActionBar) { this.#bottomBarRef = bar; }
  getSearchInput() { return this.#searchInputRef; }
  getBottomBar() { return this.#bottomBarRef; }
  getListContainer() { return this.#listContainerRef; }

  /** Effect: Sync input value to query store */
  setupStoreSync() {
    $effect(() => {
      this.localSearchValue = searchStores.query;
    });
  }
}
