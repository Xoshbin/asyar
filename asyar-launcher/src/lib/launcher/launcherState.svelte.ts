import { get } from 'svelte/store';
import { searchQuery, selectedIndex, isSearchLoading } from '../../services/search/stores/search';
import { extensionHasInputFocus } from '../../services/extension/extensionIframeManager';
import { activeView, activeViewSearchable } from '../../services/extension/extensionManager';
import { searchItems as searchItemsStore } from '../../services/search/searchOrchestrator';
import {
  contextModeService,
  contextActivationId,
  type ActiveContext,
  type ContextHint,
  type ContextChipProps,
  type ContextHintProps
} from '../../services/context/contextModeService';
import { shortcutStore, isCapturingShortcut, type ItemShortcut } from '../../built-in-extensions/shortcuts/shortcutStore';
import type { SearchResult } from '../../services/search/interfaces/SearchResult';
import type { MappedSearchItem } from '../../services/search/types/MappedSearchItem';
import type BottomActionBar from '../../components/layout/BottomActionBar.svelte';

export class LauncherState {
  // Core reactive state
  localSearchValue = $state(get(searchQuery));
  contextQuery = $state('');
  currentError = $state<string | null>(null);
  assignShortcutTarget = $state<SearchResult | null>(null);
  lastActiveViewId = $state<string | null>(null);
  searchResultItemsMapped = $state<MappedSearchItem[]>([]);
  currentSelectedItemOriginal = $state<SearchResult | null>(null);

  // Store-synced values for template binding
  activeViewVal = $state<string | null>(get(activeView));
  activeViewSearchableVal = $state<boolean>(get(activeViewSearchable));
  isSearchLoadingVal = $state<boolean>(get(isSearchLoading));
  selectedIndexVal = $state<number>(get(selectedIndex));
  contextActivationIdVal = $state<string | null>(get(contextActivationId));

  // Store references (for subscribe access)
  readonly activeContextStore = contextModeService.activeContext;
  readonly contextHintStore = contextModeService.contextHint;
  readonly searchItemsStoreRef = searchItemsStore;
  readonly shortcutStoreRef = shortcutStore;

  // Tracked store values
  activeContext = $state<ActiveContext | null>(get(contextModeService.activeContext));
  contextHint = $state<ContextHint | null>(get(contextModeService.contextHint));
  searchItems = $state<SearchResult[]>(get(searchItemsStore));
  shortcuts = $state<ItemShortcut[]>(get(shortcutStore));

  // Derived values
  activeContextChip = $derived<ContextChipProps | null>(this.activeContext
    ? { id: this.activeContext.provider.id, name: this.activeContext.provider.display.name, icon: this.activeContext.provider.display.icon, color: this.activeContext.provider.display.color }
    : null);
  contextHintChip = $derived<ContextHintProps | null>(this.contextHint
    ? { id: this.contextHint.provider.id, name: this.contextHint.provider.display.name, icon: this.contextHint.provider.display.icon, type: this.contextHint.type }
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

  /** Effect 1: Subscribe to all Svelte stores and sync into $state fields */
  setupStoreSync() {
    $effect(() => {
      const unsubs = [
        searchQuery.subscribe(v => { this.localSearchValue = v; }),
        this.activeContextStore.subscribe(v => { this.activeContext = v; }),
        this.contextHintStore.subscribe(v => { this.contextHint = v; }),
        this.searchItemsStoreRef.subscribe(v => { this.searchItems = v; }),
        this.shortcutStoreRef.subscribe(v => { this.shortcuts = v; }),
        activeView.subscribe(v => { this.activeViewVal = v; }),
        activeViewSearchable.subscribe(v => { this.activeViewSearchableVal = v; }),
        isSearchLoading.subscribe(v => { this.isSearchLoadingVal = v; }),
        selectedIndex.subscribe(v => { this.selectedIndexVal = v; }),
        contextActivationId.subscribe(v => { this.contextActivationIdVal = v; }),
      ];
      return () => unsubs.forEach(u => u());
    });
  }
}
