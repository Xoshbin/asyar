<script lang="ts">
  import { tick } from 'svelte';
import { buildMappedItems } from '../lib/searchResultMapper';
import type { MappedSearchItem } from '../services/search/types/MappedSearchItem';
import ExtensionViewContainer from '../components/extension/ExtensionViewContainer.svelte';
import SearchResultsArea from '../components/layout/SearchResultsArea.svelte';
import ShortcutCaptureOverlay from '../components/layout/ShortcutCaptureOverlay.svelte';

  import { searchQuery } from '../services/search/stores/search';
  import { logService } from '../services/log/logService';
  // Import stores directly
  import { selectedIndex, isSearchLoading, isActionDrawerOpen, extensionHasInputFocus, isCapturingShortcut, contextActivationId } from '../services/ui/uiStateStore';
  import { invoke } from '@tauri-apps/api/core';
  import SearchHeader from '../components/layout/SearchHeader.svelte';
  import BottomActionBar from '../components/layout/BottomActionBar.svelte'; // Import new component
  import extensionManager, { isReady as isExtensionManagerReady, activeView, activeViewSearchable } from '../services/extension/extensionManager'; // Import isReady
  import { applicationService } from '../services/application/applicationsService';
  import { actionService } from '../services/action/actionService';
  import { performanceService } from '../services/performance/performanceService';
  import { ClipboardHistoryService } from '../services/clipboard/clipboardHistoryService';
  import type { SearchResult } from '../services/search/interfaces/SearchResult';
  import type { ExtensionResult } from 'asyar-sdk';
  import { searchService } from '../services/search/SearchService';
  import { handleSearch, searchItems as searchItemsStore } from '../services/search/searchOrchestrator';
  import { appInitializer } from '../services/appInitializer';
  import { ActionContext } from 'asyar-sdk';
  import { isBuiltInExtension } from '../services/extension/extensionDiscovery';
  import { settingsService } from '../services/settings/settingsService';
  import { portalStore } from '../built-in-extensions/portals/portalStore';
  import { contextModeService, type ActiveContext, type ContextHint, type ContextChipProps, type ContextHintProps } from '../services/context/contextModeService';
  // Destructure the individual stores for reactive $ syntax usage
  const { activeContext: activeContextStore, contextHint: contextHintStore } = contextModeService;
  import { shortcutService } from '../built-in-extensions/shortcuts/shortcutService';
  import { shortcutStore, type ItemShortcut } from '../built-in-extensions/shortcuts/shortcutStore';
  import { createKeyboardHandlers } from '../lib/keyboard/launcherKeyboard';
  
  import '../resources/styles/style.css';

  // Removed global assignments and corresponding imports for Svelte, SvelteStore, SvelteTransition, AsyarApi

  let searchInput = $state<HTMLInputElement | null>(null);
  let listContainer = $state<HTMLDivElement | undefined>(undefined);
  let currentError = $state<string | null>(null); // State for displaying errors
  let bottomActionBarInstance: BottomActionBar; // Instance for the new bar
  let searchItems = $derived($searchItemsStore);
  let localSearchValue = $state($searchQuery);
  let lastActiveViewId = $state<string | null>(null);
  let assignShortcutTarget = $state<SearchResult | null>(null);
  let globalKeydownListenerActive = $state(false);
  let contextQuery = $state(''); // Local state for context input, bound to SearchHeader

  // Context mode state — driven by contextModeService stores
  let activeContext = $derived($activeContextStore);
  let contextHint = $derived($contextHintStore);
  // Flat props derived for SearchHeader
  let activeContextChip = $derived(activeContext
    ? { id: activeContext.provider.id, name: activeContext.provider.display.name, icon: activeContext.provider.display.icon, color: activeContext.provider.display.color } satisfies ContextChipProps
    : null);
  let contextHintChip = $derived(contextHint
    ? { id: contextHint.provider.id, name: contextHint.provider.display.name, icon: contextHint.provider.display.icon, type: contextHint.type } satisfies ContextHintProps
    : null);

  const keyboard = createKeyboardHandlers({
    getSearchInput: () => searchInput,
    getLocalSearchValue: () => localSearchValue,
    setLocalSearchValue: (v) => { localSearchValue = v; searchQuery.set(v); },
    getContextQuery: () => contextQuery,
    setContextQuery: (v) => { contextQuery = v; },
    getContextHint: () => contextHint,
    getActiveContext: () => activeContext,
    getSearchResultsLength: () => searchResultItemsMapped.length,
    getBottomBar: () => bottomActionBarInstance,
    handleEnterKey,
    handleContextDismiss,
    onBeforeHide: async () => {
      await searchService.saveIndex();
    },
  });

  // --- Reactive Statements ---

  // Sync store changes → local state
  $effect(() => { localSearchValue = $searchQuery; });
  // Sync context store changes → local state
  $effect(() => { contextQuery = activeContext?.query ?? ''; });

  // Removed reactive block calling loadView



  // Handle context activation triggered by a global keyboard shortcut
  $effect(() => {
    if ($contextActivationId !== null) {
      const idToActivate = $contextActivationId;
      contextActivationId.set(null); // consume the signal
      contextModeService.activate(idToActivate, '');
      localSearchValue = '';
      searchQuery.set('');
      tick().then(() => searchInput?.focus());
    }
  });

  // Handle trigger detection and normal search only when NOT in an extension view AND NOT in context mode
  $effect(() => {
    if (!$activeView && localSearchValue !== undefined && !activeContext) {
      const match = contextModeService.getMatch(localSearchValue);
      if (match) {
        // Full trigger typed + space → enter context mode
        contextModeService.activeContext.set({ provider: match.provider, query: match.query });
        contextModeService.contextHint.set(null);
        handleSearch(match.query || match.provider.display.name);
      } else {
        if (contextModeService.isActive()) contextModeService.deactivate();
        // Determine the hint (will be updated after search completes with hasResults flag)
        const hint = contextModeService.getHint(localSearchValue, true);
        contextModeService.contextHint.set(hint);
        handleSearch(localSearchValue);
      }
    } else if ($activeView && $activeViewSearchable && localSearchValue !== undefined) {
       logService.debug(`Search in extension: "${localSearchValue}"`);
       extensionManager.handleViewSearch(localSearchValue);
    }
  });

  $effect(() => {
    $selectedIndex = searchItems.length > 0 ? 0 : -1;
  });

  $effect(() => {
    const currentView = $activeView;

    // When leaving an extension view, clean up its registered actions
    if (lastActiveViewId !== null && currentView === null) {
      const closedExtensionId = lastActiveViewId.split('/')[0];
      actionService.clearActionsForExtension(closedExtensionId);
      logService.debug(`[Page] Cleared actions for closed extension: ${closedExtensionId}`);
    }

    lastActiveViewId = currentView;
    actionService.setContext(currentView ? ActionContext.EXTENSION_VIEW : ActionContext.CORE);
  });

   let searchResultItemsMapped = $state<MappedSearchItem[]>([]);
   let currentSelectedItemOriginal = $state<SearchResult | null>(null);

   $effect(() => {
     const { mappedItems, selectedOriginal } = buildMappedItems({
       searchItems,
       activeContext,
       shortcutStore: $shortcutStore,
       localSearchValue,
       selectedIndex: $selectedIndex,
       onError: (msg) => { currentError = msg; },
     });
     searchResultItemsMapped = mappedItems;
     currentSelectedItemOriginal = selectedOriginal;
   });

   $effect(() => {
     if (currentSelectedItemOriginal) {
       const item = currentSelectedItemOriginal;
       actionService.registerAction({
         id: 'shortcuts:assign',
         label: $shortcutStore.some((s: ItemShortcut) => s.objectId === item.objectId) ? 'Change Shortcut' : 'Assign Shortcut',
         icon: '⌨️',
         description: 'Assign global shortcut',
         category: 'Shortcuts',
         extensionId: 'shortcuts',
         context: ActionContext.CORE,
         execute: async () => {
           assignShortcutTarget = item;
           bottomActionBarInstance?.closeActionList();
         }
       });
     } else {
       actionService.unregisterAction('shortcuts:assign');
     }
     return () => {
       actionService.unregisterAction('shortcuts:assign');
     };
   });
   
    $effect(() => {
      const idx = $selectedIndex;
      if (listContainer && idx >= 0) {
        requestAnimationFrame(() => {
          const selectedElement = listContainer?.querySelector(`[data-index="${idx}"]`);
          if (selectedElement) selectedElement.scrollIntoView({ block: 'nearest' });
        });
      }
    });

  // --- Functions ---

  async function handleEnterKey() {
     if ($selectedIndex < 0 || $selectedIndex >= searchResultItemsMapped.length) {
         logService.warn(`Enter pressed with invalid selectedIndex: ${$selectedIndex}`);
         return;
     }
     const selectedItem = searchResultItemsMapped[$selectedIndex];
     if (!selectedItem) {
         logService.error(`Could not find mapped item at selectedIndex: ${$selectedIndex}`);
         return;
     }

     currentError = null; // Clear previous error before attempting action

     // Added log using original item data before execution attempt
     logService.debug(`[+page.svelte] Attempting to execute primary action for selected item: ${currentSelectedItemOriginal?.name} (Type: ${currentSelectedItemOriginal?.type}, ID: ${currentSelectedItemOriginal?.objectId})`);

     if (selectedItem.action && typeof selectedItem.action === 'function') {
       logService.debug(`Executing mapped action for: ${selectedItem.title} (Mapped ID: ${selectedItem.object_id})`);
       try {
         await selectedItem.action(); // Execute the mapped async action function
          
         // CRITICAL: Clear search input after executing a command (e.g. Ask AI)
         // to ensure the bar is empty for the next chat prompt/context.
         if (selectedItem.type === 'command') {
           localSearchValue = '';
           searchQuery.set('');
         }
       } catch(error) {
         // Errors are now set within the actionFunction definitions,
         // but log here for completeness.
         logService.error(`Caught error after executing action for item ${selectedItem.title}: ${error}`);
         // Ensure currentError reflects the failure if not already set
         if (!currentError) currentError = `Error executing action for ${selectedItem.title}`;
       }
     } else {
         // This case should be less likely now due to the fallback actionFunction
         logService.warn(`No action function found for selected item: ${selectedItem.title}`);
         currentError = `No action for ${selectedItem.title}`;
     }
  }




  function handleSearchInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    localSearchValue = value;
    searchQuery.set(value);
    currentError = null; // Clear error on new input
  }



  function handleBackClick() {
    if ($activeView) {
      extensionManager.goBack();
    }
  }

  // Removed loadView function as its logic is now integrated into the reactive block above

  function handleContextDismiss(_clearAll = false) {
    contextModeService.deactivate();
    // Always clear search — partial trigger restore caused ghost chars (e.g. "AI".slice(0,-1) = "A")
    localSearchValue = '';
    searchQuery.set('');
    contextQuery = '';
    tick().then(() => searchInput?.focus());
  }

  function handleChipDismiss() {
    // When chip × is clicked while in a view, go back AND clear chip
    handleContextDismiss(true);
    if ($activeView) {
      extensionManager.goBack();
      keyboard.restoreSearchFocus();
    }
  }

  function handleContextQueryChange(detail: { query: string }) {
    const query = detail.query;
    contextModeService.updateQuery(query);
    // When in context mode, search for the query directly
    handleSearch(query);
  }

  // Committed match: full trigger typed (exact or trigger + space + query)
  // This is now delegated to contextModeService.getMatch() in the reactive block above;
  // kept as a lightweight no-op stub in case of future direct calls.




  $effect(() => {
    // Async initialization — fire and forget pattern for $effect
    appInitializer.init().then(async () => {
      if (appInitializer.isAppInitialized()) {
        await handleSearch($searchQuery || '');
      }
      searchInput?.focus();
    });

    document.addEventListener('click', keyboard.maintainSearchFocus, true);
    window.addEventListener('keydown', keyboard.handleGlobalKeydown, true);
    globalKeydownListenerActive = true;

    return () => {
      window.removeEventListener('keydown', keyboard.handleGlobalKeydown, true);
      globalKeydownListenerActive = false;
      document.removeEventListener('click', keyboard.maintainSearchFocus, true);
    };
  });

</script>

<div class="app-root flex flex-col h-screen">
  <div class="fixed top-0 left-0 right-0 z-[100] bg-[var(--bg-primary)] shadow-md">
    <SearchHeader
      bind:ref={searchInput}
      bind:value={localSearchValue}
      showBack={!!$activeView}
      searchable={!($activeView && !$activeViewSearchable)}
      placeholder={$activeView ? ($activeViewSearchable ? "Search..." : "Press Escape to go back") : "Search or type a command..."}
      activeContext={activeContextChip}
      bind:contextQuery={contextQuery}
      contextHint={contextHintChip}
      oninput={handleSearchInput}
      onkeydown={keyboard.handleKeydown}
      onclick={handleBackClick}
      oncontextDismiss={handleChipDismiss}
      oncontextQueryChange={handleContextQueryChange}
    />
  </div>
  <!-- Spacer for SearchHeader -->
  <div class="h-[72px] flex-shrink-0"></div>
  <div class="flex-1 overflow-y-auto pb-10"> <!-- Simplified: Removed relative, added overflow and padding -->
    <!-- Main Content Area -->
    {#if $activeView}
      <ExtensionViewContainer
        activeView={$activeView}
        {extensionManager}
      />
    {:else}
      <SearchResultsArea
        items={searchResultItemsMapped}
        selectedIndex={$selectedIndex}
        isSearchLoading={$isSearchLoading}
        {currentError}
        {localSearchValue}
        bind:listContainer
        onselect={(detail) => {
          const clickedIndex = searchResultItemsMapped.findIndex(item => item.object_id === detail.item.object_id);
          if (clickedIndex !== -1) {
            $selectedIndex = clickedIndex;
            handleEnterKey();
          }
        }}
      />
    {/if}
  </div> <!-- Closes flex-1 relative div -->

  <!-- New Bottom Action Bar -->
  <BottomActionBar
    bind:this={bottomActionBarInstance}
    selectedItem={currentSelectedItemOriginal}
    errorState={currentError}
    onactionListClosed={() => { if (!assignShortcutTarget) keyboard.restoreSearchFocus(); }}
  />
  
  <!-- Modal Capture Overlay -->
  {#if assignShortcutTarget}
    <ShortcutCaptureOverlay
      target={assignShortcutTarget}
      oncapture={() => { assignShortcutTarget = null; keyboard.restoreSearchFocus(); }}
      oncancel={() => { assignShortcutTarget = null; keyboard.restoreSearchFocus(); }}
    />
  {/if}

</div>

<style global>
  /* Remove old body class styles related to action-drawer-open */

  /* Add styles if needed for when the new action list popup is open */
  /* e.g., body.action-list-open .result-item { ... } */

  /* Scrollbar styles */
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background-color: var(--scrollbar-thumb, rgba(155, 155, 155, 0.5)); border-radius: 8px; }
</style>
