import { searchStores } from '../../services/search/stores/search.svelte';
import { logService } from '../../services/log/logService';
import { searchOrchestrator } from '../../services/search/searchOrchestrator.svelte';
import { appInitializer } from '../../services/appInitializer';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { LauncherState } from './launcherState.svelte';
import { setupSearchEffects, createSearchHandlers } from './searchController.svelte';
import { setupSelectionEffects } from './selectionEffects.svelte';
import extensionManager from '../../services/extension/extensionManager.svelte';
import { commandArgumentsService } from '../../services/search/commandArguments';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { scrollSelectedIntoView } from '../listScroll';

export class LauncherController {
  readonly state = new LauncherState();

  // Expose state properties directly for template binding (delegate to state)
  get localSearchValue() {
    return this.state.localSearchValue;
  }
  set localSearchValue(v: string) {
    this.state.localSearchValue = v;
  }
  get contextQuery() {
    return this.state.contextQuery;
  }
  set contextQuery(v: string) {
    this.state.contextQuery = v;
  }
  get assignShortcutTarget() {
    return this.state.assignShortcutTarget;
  }
  set assignShortcutTarget(v: any) {
    this.state.assignShortcutTarget = v;
  }
  get assignAliasTarget() {
    return this.state.assignAliasTarget;
  }
  set assignAliasTarget(v: any) {
    this.state.assignAliasTarget = v;
  }
  get searchResultItemsMapped() {
    return this.state.searchResultItemsMapped;
  }
  get currentSelectedItemOriginal() {
    return this.state.currentSelectedItemOriginal;
  }
  get activeViewVal() {
    return this.state.activeViewVal;
  }
  get activeViewSearchableVal() {
    return this.state.activeViewSearchableVal;
  }
  get isSearchLoadingVal() {
    return this.state.isSearchLoadingVal;
  }
  get selectedIndexVal() {
    return this.state.selectedIndexVal;
  }
  get contextActivationIdVal() {
    return this.state.contextActivationIdVal;
  }
  get activeContext() {
    return this.state.activeContext;
  }
  get contextHint() {
    return this.state.contextHint;
  }
  get activeContextChip() {
    return this.state.activeContextChip;
  }
  get contextHintChip() {
    return this.state.contextHintChip;
  }

  // DOM ref delegates
  setSearchInput(el: HTMLInputElement | null) {
    this.state.setSearchInput(el);
  }
  setListContainer(el: HTMLDivElement | undefined) {
    this.state.setListContainer(el);
  }
  setBottomBar(bar: any) {
    this.state.setBottomBar(bar);
  }
  getSearchInput() {
    return this.state.getSearchInput();
  }
  getBottomBar() {
    return this.state.getBottomBar();
  }
  getListContainer() {
    return this.state.getListContainer();
  }

  // Search handlers (created once)
  #searchHandlers = createSearchHandlers(this.state);
  handleSearchInput = (event: Event) => this.#searchHandlers.handleSearchInput(event);
  handleBackClick = () => this.#searchHandlers.handleBackClick();
  handleContextDismiss = (clearAll = false) => this.#searchHandlers.handleContextDismiss(clearAll);
  handleChipDismiss = () => this.#searchHandlers.handleChipDismiss();
  handleContextQueryChange = (detail: { query: string }) =>
    this.#searchHandlers.handleContextQueryChange(detail);

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
      const listContainer = this.state.getListContainer();
      if (listContainer && idx >= 0) {
        requestAnimationFrame(() => scrollSelectedIntoView(listContainer, idx));
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

  /**
   * Hand the collected argument values to the command. `submit()` is the
   * authority on whether it runs at all, so a refusal is not an error and
   * says so in the feedback bar itself; only a command that threw is reported
   * here, with the chips left up to retry from.
   */
  async submitArguments(): Promise<void> {
    try {
      await commandArgumentsService.submit();
    } catch (err) {
      logService.error(`[argumentMode] submit failed: ${err}`);
      feedbackService.report({
        source: 'frontend',
        kind: 'action_failed',
        severity: 'error',
        retryable: false,
        context: { message: 'Could not run command with the provided arguments' },
      });
    }
  }

  async handleEnterKey() {
    const idx = this.state.selectedIndexVal;
    if (idx < 0 || idx >= this.state.searchResultItemsMapped.length) return;

    const selectedItem = this.state.searchResultItemsMapped[idx];
    if (!selectedItem) return;

    // Argument mode owns running the row, so submit the chips rather than the
    // bare command: doing the latter would ignore the `canSubmit` gate and
    // silently drop everything the user had typed. The search bar already
    // intercepts Enter for the chips, but a click on the row arrives here with
    // nothing in the way, and used to be swallowed whole.
    if (commandArgumentsService.active) {
      if (commandArgumentsService.active.commandObjectId === selectedItem.object_id) {
        await this.submitArguments();
        return;
      }
      // A different row: entry described the one it started from, so leaving
      // for this one ends it, the same as arrowing off it does.
      commandArgumentsService.exit();
    }

    // Raycast-style gating: Enter stops to collect arguments only when the
    // command declares one the user must supply and nothing can stand in for
    // it. Optional arguments never block — the command runs with whatever was
    // declared or remembered for them, and Tab remains the way to opt into
    // filling them.
    let declaredArgs: Record<string, string | number> | undefined;
    if (selectedItem.type === 'command') {
      // Values escaped out of argument entry are showing in the row's hint
      // chips, so running it takes the same route they were entered by:
      // argument mode's own submit, which is what remembers a dropdown the
      // user picked before escaping. Falls through when there is no stash, or
      // when the command can no longer be resolved.
      if (await commandArgumentsService.runWithStash(selectedItem.object_id)) return;

      const meta = await extensionManager.getCommandArgMeta(selectedItem.object_id);
      if (meta?.args.length) {
        const run = await commandArgumentsService.prepareRun(selectedItem.object_id, meta);
        if (run.needsEntry) {
          await commandArgumentsService.enter(selectedItem.object_id);
          return;
        }
        if (Object.keys(run.args).length) declaredArgs = run.args;
      }
    }

    if (selectedItem.action && typeof selectedItem.action === 'function') {
      const stackSizeBefore = viewManager.getNavigationStackSize();
      try {
        await selectedItem.action(declaredArgs ? { arguments: declaredArgs } : undefined);
        // If the action navigated, navigateToView already snapshotted and
        // cleared searchStores.query; clearing again would stomp the
        // snapshot so goBack restores "" instead of the original query.
        const navigated = viewManager.getNavigationStackSize() > stackSizeBefore;
        if (selectedItem.type === 'command' && !navigated) {
          this.state.localSearchValue = '';
          searchStores.query = '';
        }
      } catch (error) {
        logService.error(`Action error: ${error}`);
        feedbackService.report({
          source: 'frontend',
          kind: 'action_failed',
          severity: 'error',
          retryable: false,
          context: { message: 'Error executing action' },
        });
      }
    }
  }
}
