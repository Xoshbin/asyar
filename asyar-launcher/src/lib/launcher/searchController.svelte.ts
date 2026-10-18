import { tick } from 'svelte';
import { searchStores } from '../../services/search/stores/search.svelte';
import { logService } from '../../services/log/logService';
import extensionManager from '../../services/extension/extensionManager.svelte';
import { contextModeService } from '../../services/context/contextModeService.svelte';
import { contextActivationId } from '../../services/context/contextModeService.svelte';
import { searchOrchestrator } from '../../services/search/searchOrchestrator.svelte';
import type { LauncherState } from './launcherState.svelte';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import type { ContextHint, ActiveContext } from '../../services/context/contextModeService.svelte';
import { resetListScroll } from '../listScroll';

/**
 * Pure derivation: decides what `contextModeService.contextHint` should be.
 *
 * - When a Tier 2 view is active the chip must be null so it doesn't float
 *   over the view's own search bar.
 * - When a context (portal) is already committed the hint is also null.
 * - Otherwise delegates to `computeHint` (wraps `contextModeService.getHint`).
 */
export function nextContextHint(args: {
  activeViewActive: boolean;
  localSearchValue: string;
  activeContext: ActiveContext | null;
  computeHint: (text: string) => ContextHint | null;
}): ContextHint | null {
  if (args.activeViewActive) return null;
  if (args.activeContext != null) return null;
  return args.computeHint(args.localSearchValue);
}

export function setupSearchEffects(state: LauncherState) {
  // Effect 3: Handle context activation signal
  $effect(() => {
    const signal = state.contextActivationIdVal;
    if (signal !== null) {
      contextModeService.contextActivationId = null;
      contextModeService.activate(signal, '');
      state.localSearchValue = '';
      searchStores.query = '';
      tick().then(() => state.getSearchInput()?.focus());
    }
  });

  // Effect 4: Sync contextQuery from activeContext
  $effect(() => {
    state.contextQuery = state.activeContext?.query ?? '';
  });

  // Effect 5: Trigger detection and search
  $effect(() => {
    if (!state.activeViewVal && state.localSearchValue !== undefined && !state.activeContext) {
      const match = contextModeService.getMatch(state.localSearchValue);
      if (match) {
        contextModeService.activate(match.provider.id, match.query);
        searchOrchestrator.handleSearch(match.query || match.provider.display.name);
      } else {
        if (contextModeService.isActive()) contextModeService.deactivate();
        searchOrchestrator.handleSearch(state.localSearchValue);
      }
    } else if (
      state.activeViewVal &&
      state.activeViewSearchableVal &&
      state.localSearchValue !== undefined
    ) {
      logService.debug(`Search in extension: "${state.localSearchValue}"`);
      extensionManager.handleViewSearch(state.localSearchValue);
    }
    contextModeService.contextHint = nextContextHint({
      activeViewActive: !!state.activeViewVal,
      localSearchValue: state.localSearchValue ?? '',
      activeContext: state.activeContext ?? null,
      computeHint: (text) => contextModeService.getHint(text),
    });
  });

  // Effect 6: clear pinned hint when the search bar is wiped.
  // The user abandoned the prepared query; don't keep forcing a chip.
  $effect(() => {
    if (!state.localSearchValue) {
      contextModeService.pinnedHintProviderId = null;
    }
  });
}

/** Handler methods that operate on search/context state */
export function createSearchHandlers(state: LauncherState) {
  /** Publish a new query value — the single path into search. */
  function publishQuery(value: string) {
    state.localSearchValue = value;
    searchStores.query = value;
    state.queryHistory?.reset();
    feedbackService.dismiss();
    const listContainer = state.getListContainer();
    if (listContainer) resetListScroll(listContainer);
  }

  return {
    handleSearchInput(event: Event) {
      if ((event as InputEvent).isComposing) return;
      publishQuery((event.target as HTMLInputElement).value);
    },

    /**
     * Backstop for IME commits. `handleSearchInput` drops every event with
     * `isComposing: true` so half-composed text never reaches search, but
     * WebKit is inconsistent about the event that COMMITS a composition: it
     * may carry `isComposing: true`, or there may be no trailing `input` at
     * all. In those cases the committed text would never be published and the
     * search would silently ignore everything a zh-CN or Japanese user typed.
     *
     * `compositionend` always fires on commit, so publishing from here covers
     * both orderings. When a trailing non-composing `input` already published
     * the same value this is a no-op, so the common ordering costs nothing and
     * does not reset query-history recall or dismiss feedback twice.
     */
    handleSearchCompositionEnd(event: CompositionEvent) {
      const value = (event.target as HTMLInputElement | null)?.value ?? '';
      if (value === state.localSearchValue) return;
      publishQuery(value);
    },

    handleContextDismiss(_clearAll = false) {
      contextModeService.deactivate();
      state.localSearchValue = '';
      searchStores.query = '';
      state.contextQuery = '';
      state.queryHistory?.reset();
      const listContainer = state.getListContainer();
      if (listContainer) resetListScroll(listContainer);
      tick().then(() => state.getSearchInput()?.focus());
    },

    handleChipDismiss() {
      this.handleContextDismiss(true);
      if (state.activeViewVal) {
        extensionManager.goBack();
      }
    },

    handleContextQueryChange(detail: { query: string }) {
      const query = detail.query;
      contextModeService.updateQuery(query);
      searchOrchestrator.handleSearch(query);
      const listContainer = state.getListContainer();
      if (listContainer) resetListScroll(listContainer);
    },

    handleBackClick() {
      if (state.activeViewVal) {
        extensionManager.goBack();
      }
    },
  };
}
