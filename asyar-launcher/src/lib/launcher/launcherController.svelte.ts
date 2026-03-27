import { tick } from 'svelte';
import { get } from 'svelte/store';
import { searchQuery } from '../../services/search/stores/search';
import { logService } from '../../services/log/logService';
import { 
  selectedIndex, 
  isSearchLoading, 
  isActionDrawerOpen, 
  extensionHasInputFocus, 
  isCapturingShortcut, 
  contextActivationId 
} from '../../services/ui/uiStateStore';
import extensionManager, { activeView, activeViewSearchable } from '../../services/extension/extensionManager';
import { applicationService } from '../../services/application/applicationsService';
import { actionService } from '../../services/action/actionService';
import { performanceService } from '../../services/performance/performanceService';
import { ClipboardHistoryService } from '../../services/clipboard/clipboardHistoryService';
import type { SearchResult } from '../../services/search/interfaces/SearchResult';
import { searchService } from '../../services/search/SearchService';
import { handleSearch, searchItems as searchItemsStore } from '../../services/search/searchOrchestrator';
import { appInitializer } from '../../services/appInitializer';
import { ActionContext } from 'asyar-sdk';
import { 
  contextModeService, 
  type ActiveContext, 
  type ContextHint, 
  type ContextChipProps, 
  type ContextHintProps 
} from '../../services/context/contextModeService';
import { shortcutStore, type ItemShortcut } from '../../built-in-extensions/shortcuts/shortcutStore';
import { buildMappedItems } from '../searchResultMapper';
import type { MappedSearchItem } from '../../services/search/types/MappedSearchItem';
import type BottomActionBar from '../../components/layout/BottomActionBar.svelte';

export class LauncherController {
  // Reactive state
  localSearchValue = $state(get(searchQuery));
  contextQuery = $state('');
  currentError = $state<string | null>(null);
  assignShortcutTarget = $state<SearchResult | null>(null);
  lastActiveViewId = $state<string | null>(null);
  searchResultItemsMapped = $state<MappedSearchItem[]>([]);
  currentSelectedItemOriginal = $state<SearchResult | null>(null);

  // Derived/Tracked store values for template
  activeViewVal = $state<string | null>(get(activeView));
  activeViewSearchableVal = $state<boolean>(get(activeViewSearchable));
  isSearchLoadingVal = $state<boolean>(get(isSearchLoading));
  selectedIndexVal = $state<number>(get(selectedIndex));
  contextActivationIdVal = $state<string | null>(get(contextActivationId));


  // Store references
  #activeContextStore = contextModeService.activeContext;
  #contextHintStore = contextModeService.contextHint;
  #searchItemsStore = searchItemsStore;
  #shortcutStore = shortcutStore;

  // Track reactive values from stores
  activeContext = $state<ActiveContext | null>(get(this.#activeContextStore));
  contextHint = $state<ContextHint | null>(get(this.#contextHintStore));
  searchItems = $state<SearchResult[]>(get(this.#searchItemsStore));
  shortcuts = $state<ItemShortcut[]>(get(this.#shortcutStore));

  // Derived values for UI components
  activeContextChip = $derived<ContextChipProps | null>(this.activeContext
    ? { id: this.activeContext.provider.id, name: this.activeContext.provider.display.name, icon: this.activeContext.provider.display.icon, color: this.activeContext.provider.display.color }
    : null);
  contextHintChip = $derived<ContextHintProps | null>(this.contextHint
    ? { id: this.contextHint.provider.id, name: this.contextHint.provider.display.name, icon: this.contextHint.provider.display.icon, type: this.contextHint.type }
    : null);

  // DOM ref accessors
  #searchInputRef = $state<HTMLInputElement | null>(null);
  #listContainerRef = $state<HTMLDivElement | undefined>(undefined);
  #bottomBarRef: BottomActionBar | undefined;

  setSearchInput(el: HTMLInputElement | null) { this.#searchInputRef = el; }
  setListContainer(el: HTMLDivElement | undefined) { this.#listContainerRef = el; }
  setBottomBar(bar: BottomActionBar) { this.#bottomBarRef = bar; }
  getSearchInput() { return this.#searchInputRef; }
  getBottomBar() { return this.#bottomBarRef; }
  getListContainer() { return this.#listContainerRef; }

  constructor() {
    // Initial values are set at field declaration level via get(store)
  }


  setupEffects() {
    // 1. Sync store values reactively with cleanup
    $effect(() => {
      const unsubs = [
        searchQuery.subscribe(v => { this.localSearchValue = v; }),
        this.#activeContextStore.subscribe(v => { this.activeContext = v; }),
        this.#contextHintStore.subscribe(v => { this.contextHint = v; }),
        this.#searchItemsStore.subscribe(v => { this.searchItems = v; }),
        this.#shortcutStore.subscribe(v => { this.shortcuts = v; }),
        activeView.subscribe(v => { this.activeViewVal = v; }),
        activeViewSearchable.subscribe(v => { this.activeViewSearchableVal = v; }),
        isSearchLoading.subscribe(v => { this.isSearchLoadingVal = v; }),
        selectedIndex.subscribe(v => { this.selectedIndexVal = v; }),
        contextActivationId.subscribe(v => { this.contextActivationIdVal = v; }),
      ];
      return () => unsubs.forEach(u => u());
    });

    // 3. Handle context activation signal
    $effect(() => {
        const signal = this.contextActivationIdVal;
        if (signal !== null) {
            contextActivationId.set(null); 
            contextModeService.activate(signal, '');
            this.localSearchValue = '';
            searchQuery.set('');
            tick().then(() => this.#searchInputRef?.focus());
        }
    });


    // 4. Sync contextQuery from activeContext
    $effect(() => {
        this.contextQuery = this.activeContext?.query ?? '';
    });

    // 5. Trigger detection and search
    $effect(() => {
        if (!this.activeViewVal && this.localSearchValue !== undefined && !this.activeContext) {
            const match = contextModeService.getMatch(this.localSearchValue);
            if (match) {
                this.#activeContextStore.set({ provider: match.provider, query: match.query });
                this.#contextHintStore.set(null);
                handleSearch(match.query || match.provider.display.name);
            } else {
                if (contextModeService.isActive()) contextModeService.deactivate();
                const hint = contextModeService.getHint(this.localSearchValue, true);
                this.#contextHintStore.set(hint);
                handleSearch(this.localSearchValue);
            }
        } else if (this.activeViewVal && this.activeViewSearchableVal && this.localSearchValue !== undefined) {
             logService.debug(`Search in extension: "${this.localSearchValue}"`);
             extensionManager.handleViewSearch(this.localSearchValue);
        }
    });

    // 6. Update index when search items change
    $effect(() => {
        selectedIndex.set(this.searchItems.length > 0 ? 0 : -1);
    });

    // 7. Extension view cleanup
    $effect(() => {
        const currentView = this.activeViewVal;
        if (this.lastActiveViewId !== null && currentView === null) {
            const closedExtensionId = this.lastActiveViewId.split('/')[0];
            actionService.clearActionsForExtension(closedExtensionId);
        }
        this.lastActiveViewId = currentView;
        actionService.setContext(currentView ? ActionContext.EXTENSION_VIEW : ActionContext.CORE);
    });

    // 8. Mapping search results
    $effect(() => {
        const { mappedItems, selectedOriginal } = buildMappedItems({
            searchItems: this.searchItems,
            activeContext: this.activeContext,
            shortcutStore: this.shortcuts,
            localSearchValue: this.localSearchValue,
            selectedIndex: this.selectedIndexVal,
            onError: (msg) => { this.currentError = msg; },
        });
        this.searchResultItemsMapped = mappedItems;
        this.currentSelectedItemOriginal = selectedOriginal;
    });

    // 9. Shortcut action
    $effect(() => {
        if (this.currentSelectedItemOriginal) {
            const item = this.currentSelectedItemOriginal;
            actionService.registerAction({
                id: 'shortcuts:assign',
                label: this.shortcuts.some((s: ItemShortcut) => s.objectId === item.objectId) ? 'Change Shortcut' : 'Assign Shortcut',
                icon: '⌨️',
                description: 'Assign global shortcut',
                category: 'Shortcuts',
                extensionId: 'shortcuts',
                context: ActionContext.CORE,
                execute: async () => {
                    this.assignShortcutTarget = item;
                    this.#bottomBarRef?.closeActionList();
                }
            });
        } else {
            actionService.unregisterAction('shortcuts:assign');
        }
        return () => {
            actionService.unregisterAction('shortcuts:assign');
        };
    });

    // 10. Scrolling
    $effect(() => {
        const idx = this.selectedIndexVal;
        if (this.#listContainerRef && idx >= 0) {
            requestAnimationFrame(() => {
                const selectedElement = this.#listContainerRef?.querySelector(`[data-index="${idx}"]`);
                if (selectedElement) selectedElement.scrollIntoView({ block: 'nearest' });
            });
        }
    });

    // 11. App Initialization
    $effect(() => {
        appInitializer.init().then(async () => {
            if (appInitializer.isAppInitialized()) {
                await handleSearch(get(searchQuery) || '');
            }
            this.#searchInputRef?.focus();
        });
    });
  }

  // Handlers
  async handleEnterKey() {
      const idx = this.selectedIndexVal;
      if (idx < 0 || idx >= this.searchResultItemsMapped.length) return;
      
      const selectedItem = this.searchResultItemsMapped[idx];
      if (!selectedItem) return;

      this.currentError = null;

      if (selectedItem.action && typeof selectedItem.action === 'function') {
        try {
          await selectedItem.action();
          if (selectedItem.type === 'command') {
            this.localSearchValue = '';
            searchQuery.set('');
          }
        } catch(error) {
          logService.error(`Action error: ${error}`);
          this.currentError = this.currentError || `Error executing action`;
        }
      }
  }

  handleSearchInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.localSearchValue = value;
    searchQuery.set(value);
    this.currentError = null;
  }

  handleBackClick() {
    if (this.activeViewVal) {
      extensionManager.goBack();
    }
  }

  handleContextDismiss(_clearAll = false) {
    contextModeService.deactivate();
    this.localSearchValue = '';
    searchQuery.set('');
    this.contextQuery = '';
    tick().then(() => this.#searchInputRef?.focus());
  }

  handleChipDismiss() {
    this.handleContextDismiss(true);
    if (this.activeViewVal) {
      extensionManager.goBack();
    }
  }

  handleContextQueryChange(detail: { query: string }) {
    const query = detail.query;
    contextModeService.updateQuery(query);
    handleSearch(query);
  }
}
