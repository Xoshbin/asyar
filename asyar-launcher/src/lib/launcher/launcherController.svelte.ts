import { searchStores } from '../../services/search/stores/search.svelte';
import { logService } from '../../services/log/logService';
import { searchOrchestrator } from '../../services/search/searchOrchestrator.svelte';
import { appInitializer } from '../../services/appInitializer';
import { LauncherState } from './launcherState.svelte';
import { setupSearchEffects, createSearchHandlers } from './searchController.svelte';
import { setupSelectionEffects } from './selectionEffects.svelte';

export class LauncherController {
  readonly state = new LauncherState();

  // Expose state properties directly for template binding (delegate to state)
  get localSearchValue() { return this.state.localSearchValue; }
  set localSearchValue(v: string) { this.state.localSearchValue = v; }
  get contextQuery() { return this.state.contextQuery; }
  set contextQuery(v: string) { this.state.contextQuery = v; }
  get currentError() { return this.state.currentError; }
  set currentError(v: string | null) { this.state.currentError = v; }
  get assignShortcutTarget() { return this.state.assignShortcutTarget; }
  set assignShortcutTarget(v: any) { this.state.assignShortcutTarget = v; }
  get searchResultItemsMapped() { return this.state.searchResultItemsMapped; }
  get currentSelectedItemOriginal() { return this.state.currentSelectedItemOriginal; }
  get activeViewVal() { return this.state.activeViewVal; }
  get activeViewSearchableVal() { return this.state.activeViewSearchableVal; }
  get isSearchLoadingVal() { return this.state.isSearchLoadingVal; }
  get selectedIndexVal() { return this.state.selectedIndexVal; }
  get contextActivationIdVal() { return this.state.contextActivationIdVal; }
  get activeContext() { return this.state.activeContext; }
  get contextHint() { return this.state.contextHint; }
  get activeContextChip() { return this.state.activeContextChip; }
  get contextHintChip() { return this.state.contextHintChip; }

  // DOM ref delegates
  setSearchInput(el: HTMLInputElement | null) { this.state.setSearchInput(el); }
  setListContainer(el: HTMLDivElement | undefined) { this.state.setListContainer(el); }
  setBottomBar(bar: any) { this.state.setBottomBar(bar); }
  getSearchInput() { return this.state.getSearchInput(); }
  getBottomBar() { return this.state.getBottomBar(); }
  getListContainer() { return this.state.getListContainer(); }

  // Search handlers (created once)
  #searchHandlers = createSearchHandlers(this.state);
  handleSearchInput = (event: Event) => this.#searchHandlers.handleSearchInput(event);
  handleBackClick = () => this.#searchHandlers.handleBackClick();
  handleContextDismiss = (clearAll = false) => this.#searchHandlers.handleContextDismiss(clearAll);
  handleChipDismiss = () => this.#searchHandlers.handleChipDismiss();
  handleContextQueryChange = (detail: { query: string }) => this.#searchHandlers.handleContextQueryChange(detail);

  setupEffects() {
    // 1. Store sync (data layer)
    this.state.setupStoreSync();

    // 2. Search & context effects
    setupSearchEffects(this.state);

    // 3. Selection, mapping & action effects
    setupSelectionEffects(this.state);

    // 4. Scroll-to-selected
    $effect(() => {
      const idx = this.state.selectedIndexVal;
      if (this.state.getListContainer() && idx >= 0) {
        requestAnimationFrame(() => {
          const selectedElement = this.state.getListContainer()?.querySelector(`[data-index="${idx}"]`);
          if (selectedElement) selectedElement.scrollIntoView({ block: 'nearest' });
        });
      }
    });

    // 5. App initialization
    $effect(() => {
      appInitializer.init().then(async () => {
        if (appInitializer.isAppInitialized()) {
          await searchOrchestrator.handleSearch(searchStores.query || '');
        }
        this.state.getSearchInput()?.focus();
      });
    });
  }

  async handleEnterKey() {
    const idx = this.state.selectedIndexVal;
    if (idx < 0 || idx >= this.state.searchResultItemsMapped.length) return;

    const selectedItem = this.state.searchResultItemsMapped[idx];
    if (!selectedItem) return;

    this.state.currentError = null;

    if (selectedItem.action && typeof selectedItem.action === 'function') {
      try {
        await selectedItem.action();
        if (selectedItem.type === 'command') {
          this.state.localSearchValue = '';
          searchStores.query = '';
        }
      } catch (error) {
        logService.error(`Action error: ${error}`);
        this.state.currentError = this.state.currentError || 'Error executing action';
      }
    }
  }
}
