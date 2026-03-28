import { tick } from 'svelte';
import { get } from 'svelte/store';
import { searchStores } from '../../services/search/stores/search.svelte';
import { logService } from '../../services/log/logService';
import extensionManager from '../../services/extension/extensionManager';
import { contextModeService } from '../../services/context/contextModeService';
import { contextActivationId } from '../../services/context/contextModeService';
import { handleSearch } from '../../services/search/searchOrchestrator';
import type { LauncherState } from './launcherState.svelte';

export function setupSearchEffects(state: LauncherState) {
  // Effect 3: Handle context activation signal
  $effect(() => {
    const signal = state.contextActivationIdVal;
    if (signal !== null) {
      contextActivationId.set(null);
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
        state.activeContextStore.set({ provider: match.provider, query: match.query });
        state.contextHintStore.set(null);
        handleSearch(match.query || match.provider.display.name);
      } else {
        if (contextModeService.isActive()) contextModeService.deactivate();
        const hint = contextModeService.getHint(state.localSearchValue, true);
        state.contextHintStore.set(hint);
        handleSearch(state.localSearchValue);
      }
    } else if (state.activeViewVal && state.activeViewSearchableVal && state.localSearchValue !== undefined) {
      logService.debug(`Search in extension: "${state.localSearchValue}"`);
      extensionManager.handleViewSearch(state.localSearchValue);
    }
  });
}

/** Handler methods that operate on search/context state */
export function createSearchHandlers(state: LauncherState) {
  return {
    handleSearchInput(event: Event) {
      const value = (event.target as HTMLInputElement).value;
      state.localSearchValue = value;
      searchStores.query = value;
      state.currentError = null;
    },

    handleContextDismiss(_clearAll = false) {
      contextModeService.deactivate();
      state.localSearchValue = '';
      searchStores.query = '';
      state.contextQuery = '';
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
      handleSearch(query);
    },

    handleBackClick() {
      if (state.activeViewVal) {
        extensionManager.goBack();
      }
    },
  };
}
