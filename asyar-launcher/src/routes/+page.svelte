<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { searchQuery } from '../stores/search';
  import { logService } from '../services/logService';
  import { invoke } from '@tauri-apps/api/core';
  import SearchHeader from '../components/layout/SearchHeader.svelte';
  import { ResultsList, ActionPanel } from '../components';
  import extensionManager, { activeView, activeViewSearchable } from '../services/extensionManager';
  import { applicationService } from '../services/applicationsService';
  import { actionService, actionStore, ActionContext } from '../services/actionService';
  import { performanceService } from '../services/performanceService';
  import type { ApplicationAction } from '../services/actionService';
  import { ClipboardHistoryService } from '../services/clipboardHistoryService';
  import type { SearchResult } from '../services/search/interfaces/SearchResult';
  import { searchService } from '../services/search/SearchService';

  let searchInput: HTMLInputElement;
  let listContainer: HTMLDivElement;
  let loadedComponent: any = null;
  let isInitialized = false;
  let searchItems: SearchResult[] = [];
  let isSearchLoading = false;
  let selectedIndex = -1;
  let localSearchValue = $searchQuery;

  $: localSearchValue = $searchQuery;
  $: if ($activeView) {
    loadView($activeView);
    selectedIndex = -1; // Reset selection when entering a view
  } else {
     setTimeout(() => searchInput?.focus(), 10);
  }

  $: if (!$activeView && localSearchValue !== undefined) { // Check localSearchValue to avoid initial undefined call
     handleSearch(localSearchValue);
  } else if ($activeView && $activeViewSearchable && localSearchValue !== undefined) {
     logService.debug(`Search in extension: "${localSearchValue}"`);
     extensionManager.handleViewSearch(localSearchValue);
  }

  $: if (searchItems) { // Reset selected index when search results change
    selectedIndex = searchItems.length > 0 ? 0 : -1;
  }

  $: { // Action Context
    actionService.setContext($activeView ? ActionContext.EXTENSION_VIEW : ActionContext.CORE);
  }

   $: { // Maintain Focus
    if (searchInput && !isActionDrawerOpen) {
      setTimeout(() => {
        if (!isActionDrawerOpen && searchInput && (!document.activeElement || document.activeElement !== searchInput)) {
          searchInput.focus();
           if(document.activeElement === searchInput) {
               searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
           }
        }
      }, 10);
    }
  }

   $: if (listContainer && selectedIndex >= 0) { // Scroll Logic
     requestAnimationFrame(() => {
         const selectedElement = listContainer.querySelector(`[data-index="${selectedIndex}"]`);
         if (selectedElement) {
           selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
         }
     });
   }


   $: searchResultItems = searchItems.map(result => {
    const objectId = result.objectId as string | undefined; // Use correct case based on your logs/interface
    const name = result.name || 'Unknown Item';
    const type = result.type || 'unknown';
    const score = result.score || 0;
    const path = result.path;
    const extensionAction = result.action;

    let icon = '🧩';
    if (type === 'application') icon = '🖥️';
    else if (type === 'command') icon = '❯_';

    let actionFunction: () => void;

    // --- Define Action ---
    if (type === 'application' && path) {
      // Application action remains the same (calls applicationService)
      actionFunction = () => {
        logService.debug(`Calling applicationService.open for ${name} (ID: ${objectId}, Path: ${path})`);
        applicationService.open({ objectId, name, path, score })
          .catch(err => logService.error(`applicationService.open failed: ${err}`));
      };
    // --- CHANGE THIS PART ---
    } else if (type === 'command' && objectId) {
      // Command action now calls extensionManager
      const commandObjectId = objectId; // Capture the valid objectId
      actionFunction = () => {
         logService.debug(`Calling extensionManager.handleCommandAction for: ${commandObjectId}`);
         // Call the new method on the imported extensionManager instance
         extensionManager.handleCommandAction(commandObjectId);
      }
    // --- END CHANGE ---
    } else if (typeof extensionAction === 'function') {
       // Keep handling for actions potentially provided directly by extensions if needed
       actionFunction = extensionAction;
    } else {
      // Fallback remains the same
      actionFunction = () => { /* ... log warnings ... */ };
    }
    // --- End Define Action ---

    const finalObjectId = typeof objectId === 'string' && objectId ? objectId : `fallback_id_${Math.random()}`;
    // ... (rest of the mapping: fallback check, return object) ...
     if (finalObjectId.startsWith('fallback')) {
        logService.warn('Result item missing/invalid objectId:', name, type);
    }

     return {
      object_id: finalObjectId, // Use consistent ID for internal Svelte list/keys
      title: name,
      subtitle: type !== 'unknown' ? `Type: ${type}` : '',
      icon: icon,
      score: score,
      action: actionFunction
    };
  });


  async function handleEnterKey() {
     if (selectedIndex < 0 || selectedIndex >= searchResultItems.length) {
         logService.warn(`Enter pressed with invalid selectedIndex: ${selectedIndex}`);
         return;
     }
     const selectedItem = searchResultItems[selectedIndex];
     if (!selectedItem) {
         logService.error(`Could not find item at selectedIndex: ${selectedIndex}`);
         return;
     }

     // Usage recording is now assumed to be handled within the action itself
     // (specifically within applicationService.open for apps)

     // Execute Action
     if (selectedItem.action && typeof selectedItem.action === 'function') {
       logService.debug(`Executing action for: ${selectedItem.title} (ID: ${selectedItem.object_id})`);
       try {
         selectedItem.action(); // This calls applicationService.open for apps, or the extension action, or the fallback
       } catch(error) {
         logService.error(`Error executing action for item ${selectedItem.title}: ${error}`);
       }
     } else {
         logService.warn(`No action defined or executable for selected item: ${selectedItem.title}`);
     }
   }

 function handleGlobalKeydown(event: KeyboardEvent) {
    if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      toggleActionDrawer();
      return;
    }
    if (isActionDrawerOpen) return;

    // Defer navigation keys if in an extension view
    if ($activeView && ['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) {
        // Let specific handlers or the default browser behavior take over in extension views
       return;
    }
     // Exception: Allow main keydown handler to process Escape/Backspace/Delete even in views for exit logic
     if ($activeView && ['Escape', 'Backspace', 'Delete'].includes(event.key)) {
         // Proceed to main handleKeydown
     }


    // Re-focus search input - improved logic
    if (!isActionDrawerOpen && searchInput && document.activeElement !== searchInput && !isActiveElementInteractive()) {
        // Only refocus if the event target wasn't clearly interactive itself
        const target = event.target as HTMLElement;
         if(!(target.closest('button, a, input, select, textarea, [role="button"], [role="link"], .result-item'))) {
            searchInput.focus();
        }
    }
  }

  // Helper to check if the current active element is interactive
  function isActiveElementInteractive(): boolean {
    const activeElement = document.activeElement;
    if (!activeElement) return false;

    const nodeName = activeElement.nodeName.toLowerCase();
    const isFormElement = ['input', 'select', 'textarea', 'button'].includes(nodeName);
    const hasContentEditable = (activeElement as HTMLElement).isContentEditable;
    const hasInteractiveRole = activeElement.getAttribute('role')?.match(/^(button|checkbox|combobox|menuitem|option|radio|slider|switch|tab|textbox)$/);
    const isLink = nodeName === 'a' && activeElement.hasAttribute('href');

     // Consider if inside an extension view
     const isInExtensionView = !!$activeView && activeElement.closest(`[data-extension-view="${$activeView}"]`) != null;


    return isFormElement || hasContentEditable || !!hasInteractiveRole || isLink || isInExtensionView;
  }

  // Keep the global keydown listener always active
  let globalKeydownListenerActive = false;
  $: {
    if (!globalKeydownListenerActive && typeof window !== 'undefined') {
      window.addEventListener('keydown', handleGlobalKeydown, true);
      globalKeydownListenerActive = true;
      //logService.debug(`Added global keydown listener`); // Can be noisy
    }
  }

  // Handle search input changes
  function handleSearchInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    localSearchValue = value;
    searchQuery.set(value); // Update store for potential listeners
    // Search is now triggered by the reactive block `$: if (!$activeView...)`
  }

  // Main keydown handler for the search input
  function handleKeydown(event: KeyboardEvent) {
    // --- Escape Logic ---
    if (event.key === 'Escape') {
      event.preventDefault();
      if (isActionDrawerOpen) {
        toggleActionDrawer(); // Close drawer first
      } else if ($activeView) {
        logService.debug(`Escape pressed in view, returning to main screen`);
        extensionManager.closeView();
      } else {
        logService.debug(`Escape pressed in main view, hiding app`);
        invoke('hide');
      }
      return;
    }

    // --- Backspace/Delete on Empty Input in View Logic ---
    if ($activeView && (event.key === 'Backspace' || event.key === 'Delete') && searchInput?.value === '') {
      event.preventDefault();
      logService.debug(`Backspace/Delete on empty input in view, returning to main screen`);
      extensionManager.closeView();
      return;
    }

    // --- Navigation and Enter Logic (Only in Main View) ---
    if (!$activeView) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const totalItems = searchResultItems.length; // Use length of the new list
        if (totalItems === 0) return;

        let newIndex = selectedIndex; // Use local selectedIndex
        if (event.key === 'ArrowDown') {
          newIndex = (selectedIndex + 1) % totalItems;
        } else { // ArrowUp
          newIndex = (selectedIndex - 1 + totalItems) % totalItems;
        }
        selectedIndex = newIndex; // Update local selectedIndex
      }
      else if (event.key === 'Enter') {
         event.preventDefault(); // Prevent potential form submission
        handleEnterKey(); // Call updated Enter key handler
      }
    }
    // --- End Navigation and Enter Logic ---

     // Prevent default browser behavior for up/down arrows if they weren't handled above
     // Only prevent if focus is on searchInput or we are not in an active view
     if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && (document.activeElement === searchInput || !$activeView)) {
         event.preventDefault();
     }
  }


  function handleBackClick() {
    if ($activeView) {
      logService.debug(`Back button clicked, returning to main screen`);
      extensionManager.closeView();
    }
  }

  async function loadView(viewPath: string) {
    // Reset search query when loading a view
    localSearchValue = '';
    searchQuery.set('');
    try {
      logService.debug(`Loading view for path: ${viewPath}`);
      const [extensionName, componentName] = viewPath.split('/');
      const module = await import(`../extensions/${extensionName}/${componentName}.svelte`);
      if (!module.default) throw new Error('View component not found in module');
      loadedComponent = module.default;
      logService.debug(`Successfully loaded view component`);
      // Focus search input after loading view, maybe with delay
       setTimeout(() => searchInput?.focus(), 50);
    } catch (error) {
      logService.error(`Failed to load view ${viewPath}: ${error}`);
      extensionManager.closeView(); // Reset on error
    }
  }

  async function handleSearch(query: string) {
    if (!isInitialized || $activeView) {
      return;
    }
    isSearchLoading = true;
    try {
      const resultsFromRust: SearchResult[] = await searchService.performSearch(query);

      // --- NEW LOGS to Check Keys/Types ---
      if (resultsFromRust && resultsFromRust.length > 0) {
           logService.debug(`Received ${resultsFromRust.length} results from Rust.`);
           const firstFew = resultsFromRust.slice(0, 3); // Look at first 3 items
           firstFew.forEach((item, index) => {
               if(item) { // Check if item itself is not null/undefined
                   // Log the keys found in the object
                   const keys = Object.keys(item);
                   logService.debug(`Result[${index}] Keys: ${keys.join(', ')}`);

                   // Optionally, log the type of the ID field if found
                   if ('objectId' in item) {
                       logService.debug(`Result[${index}] Found key 'objectId', type: ${typeof (item as any).objectId}`);
                   } else if ('object_id' in item) {
                       logService.debug(`Result[${index}] Found key 'object_id', type: ${typeof (item as any).object_id}`);
                   } else {
                       logService.debug(`Result[${index}] Neither 'objectId' nor 'object_id' key found.`);
                   }

               } else {
                   logService.warn(`Result[${index}] is null or undefined.`);
               }
           });
      } else {
           logService.debug('Raw results from Rust: Received empty array or null/undefined.');
      }
      // --- END LOGS ---

      searchItems = resultsFromRust; // Keep this - assign data AFTER logging
      // REMOVED logService.debug(`Search completed. Received ${searchItems.length} items.`); - Redundant with log above

    } catch (error) {
      logService.error(`Search failed: ${error}`);
      searchItems = [];
    } finally {
      isSearchLoading = false;
    }
  }

  // Function to ensure search input keeps focus (simplified)
  function maintainSearchFocus(e: MouseEvent) {
     // Allow clicks on interactive elements (buttons, links, inputs, etc.)
     const target = e.target as HTMLElement;
     const isInteractive = target.closest('button, a, input, select, textarea, [role="button"], [role="link"], .result-item');

     if (!isInteractive && searchInput && document.activeElement !== searchInput && !$activeView && !isActionDrawerOpen) {
         setTimeout(() => {
             searchInput.focus();
             // Move cursor to end
             searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
         }, 10); // Small delay
     }
  }


  onMount(async () => {
    // Initialize performance service first
    // await invoke("reset_search_index"); // Probably remove this from onMount
    await performanceService.init();
    logService.custom("🔍 Performance monitoring initialized", "PERF", "cyan", "cyan");
    performanceService.logPerformanceReport();

    logService.info(`Application starting...`);
    const clipboardHistoryService = ClipboardHistoryService.getInstance();
    await clipboardHistoryService.initialize();
    logService.info(`Clipboard history service initialized at app startup`);

    try {
      performanceService.startTiming("app-initialization");
      performanceService.startTiming("service-init");

      await applicationService.init();
      await extensionManager.init();

      const serviceInitMetrics = performanceService.stopTiming("service-init");
      logService.custom(`🔌 Services initialized in ${serviceInitMetrics.duration?.toFixed(2)}ms`, "PERF", "green");

      isInitialized = true;

      const initMetrics = performanceService.stopTiming("app-initialization");
      logService.custom(`⚡ App initialized in ${initMetrics.duration?.toFixed(2)}ms`, "PERF", "green", "bgGreen");

      // Initial search (will show suggestions if query is empty)
      await handleSearch($searchQuery || ''); // Ensure we pass empty string if null/undefined

      if (searchInput) searchInput.focus();
      document.addEventListener('click', maintainSearchFocus);

      setTimeout(() => performanceService.logPerformanceReport(), 1000);
    } catch (error) {
      logService.error(`Failed to initialize: ${error}`);
    }

    if (!globalKeydownListenerActive) {
      window.addEventListener('keydown', handleGlobalKeydown, true);
      globalKeydownListenerActive = true;
    }
  });

  onDestroy(() => {
    if (globalKeydownListenerActive) {
      window.removeEventListener('keydown', handleGlobalKeydown, true);
      globalKeydownListenerActive = false;
    }
    document.removeEventListener('click', maintainSearchFocus);
    if (unsubscribeActions) unsubscribeActions();
    if (isActionDrawerOpen) {
      document.removeEventListener('keydown', captureAllKeydowns, true);
    }
  });


  // --- Action Drawer state and functions (No changes needed here) ---
  let isActionDrawerOpen = false;
  let selectedActionIndex = 0;
  let actionDrawerRef: HTMLElement;
  let actionButtons: HTMLButtonElement[] = [];
  let availableActions: ApplicationAction[] = [];
  let actionPanelActions = [{ id: 'actions', label: '⌘ K Actions', icon: '' }];
  const unsubscribeActions = actionStore.subscribe(actions => {
    availableActions = actions;
    // logService.debug(`Actions updated: ${actions.length} actions available`); // Can be noisy
    if (isActionDrawerOpen) selectedActionIndex = 0;
  });

  function handleActionPanelAction(event) {
    if (event.detail.actionId === 'actions') toggleActionDrawer();
  }

  function toggleActionDrawer() {
    isActionDrawerOpen = !isActionDrawerOpen;
    if (isActionDrawerOpen) {
      document.body.classList.add('action-drawer-open');
      // Determine context based on view
      actionService.setContext($activeView ? ActionContext.EXTENSION_VIEW : ActionContext.CORE);
      selectedActionIndex = 0;
      document.addEventListener('keydown', captureAllKeydowns, true);
      setTimeout(() => {
        actionButtons = Array.from(actionDrawerRef?.querySelectorAll('button') || []);
        actionButtons[0]?.focus() || actionDrawerRef?.focus();
      }, 50);
    } else {
      document.body.classList.remove('action-drawer-open');
      document.removeEventListener('keydown', captureAllKeydowns, true);
      // Restore context based on view
      actionService.setContext($activeView ? ActionContext.EXTENSION_VIEW : ActionContext.CORE);
      setTimeout(() => searchInput?.focus(), 50);
    }
  }

 function captureAllKeydowns(event: KeyboardEvent) {
    // Let Escape bubble up so main handler can close drawer
     if (event.key === 'Escape'){
         // We might still want to prevent default Escape behavior if drawer is open
         event.preventDefault();
         // Stop propagation isn't strictly needed if we handle it later, but safer
         event.stopPropagation();
         handleActionKeydown(event); // Let handler manage closing
         return;
     }
    if (isActionDrawerOpen && ['ArrowUp', 'ArrowDown', 'Tab', 'Enter', ' '].includes(event.key)) {
      event.stopPropagation(); // Stop propagation for handled keys
      handleActionKeydown(event);
    } else if (isActionDrawerOpen) {
       // Prevent any other keydown events from propagating out of the drawer
       event.stopPropagation();
       // Optionally prevent default for other keys too if they cause issues
       // event.preventDefault();
    }
  }


  function handleActionKeydown(event: KeyboardEvent) {
    // This function now also handles Escape because captureAllKeydowns passes it down
    if (!isActionDrawerOpen) return; // Guard against race conditions

    if (event.key === 'Escape') {
        event.preventDefault(); // Prevent default Escape behavior
        toggleActionDrawer(); // Close drawer
        return;
    }


    if (availableActions.length === 0) return; // No actions to navigate

    const totalActions = availableActions.length;
    let preventDefault = true;

    switch (event.key) {
      case 'ArrowDown':
      case 'Tab':
        if (event.key === 'Tab' && event.shiftKey) {
             selectedActionIndex = (selectedActionIndex - 1 + totalActions) % totalActions;
        } else {
             selectedActionIndex = (selectedActionIndex + 1) % totalActions;
        }
        focusSelectedAction();
        break;
      case 'ArrowUp':
        selectedActionIndex = (selectedActionIndex - 1 + totalActions) % totalActions;
        focusSelectedAction();
        break;
      case 'Enter':
      case ' ':
        if (selectedActionIndex >= 0 && selectedActionIndex < totalActions) {
          handleActionSelect(availableActions[selectedActionIndex].id);
        }
        break;
      // Escape case is handled above
      default:
         preventDefault = false;
    }

    if(preventDefault) {
        event.preventDefault();
    }
  }


  function focusSelectedAction() {
    setTimeout(() => {
      actionButtons = Array.from(actionDrawerRef?.querySelectorAll('button') || []);
      actionButtons[selectedActionIndex]?.focus();
    }, 10);
  }

  function handleActionSelect(actionId: string) {
    logService.debug(`Action selected: ${actionId}`);
    toggleActionDrawer(); // Close drawer
    try {
      // Focus might already be back on input due to toggleActionDrawer, but ensure it
      setTimeout(() => searchInput?.focus(), 50);
      actionService.executeAction(actionId);
    } catch (error) {
      logService.error(`Failed to execute action ${actionId}: ${error}`);
    }
  }

</script>

<div class="flex flex-col h-screen">
  <div class="fixed top-0 left-0 right-0 z-[100] bg-[var(--bg-primary)] shadow-md">
    <SearchHeader
      bind:this={searchInput}
      value={localSearchValue}
      showBack={!!$activeView}
      searchable={!($activeView && !$activeViewSearchable)}
      placeholder={$activeView ? ($activeViewSearchable ? "Search..." : "Press Escape to go back") : "Search or type a command..."}
      on:input={handleSearchInput}
      on:keydown={handleKeydown}
      on:click={handleBackClick}
    />
  </div>
  <div class="h-[72px] flex-shrink-0"></div> <div class="flex-1 relative">
    <div class="absolute inset-0 pb-16 overflow-y-auto"> {#if $activeView && loadedComponent}
        <div class="min-h-full" data-extension-view={$activeView}>
          <svelte:component this={loadedComponent} />
        </div>
      {:else}
        <div class="min-h-full">
          <div bind:this={listContainer}>
             {#if isSearchLoading}
                <div class="p-4 text-center text-[var(--text-secondary)]">Loading...</div>
             {:else if searchResultItems.length > 0}
                 <ResultsList
                   items={searchResultItems}
                   selectedIndex={selectedIndex}
                   on:select={({ detail }) => {
                     // Handle direct click selection
                     // Find index based on object_id to be robust
                     const clickedIndex = searchResultItems.findIndex(item => item.object_id === detail.item.object_id);
                     if (clickedIndex !== -1) {
                         selectedIndex = clickedIndex;
                         handleEnterKey(); // Trigger same action as Enter key
                     } else {
                         // Use detail.item if available in the warning
                         logService.warn(`Clicked item not found in current results:`, detail.item ?? 'Unknown item clicked');
                     }
                   }}
                 />
            {:else if !isSearchLoading && localSearchValue}
                <div class="p-4 text-center text-[var(--text-secondary)]">No results found.</div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>

  {#if isActionDrawerOpen}
    <div bind:this={actionDrawerRef} class="action-drawer fixed bottom-14 right-0 z-50 flex justify-end pr-4" tabindex="-1">
       <div
         class="w-full max-w-sm overflow-hidden transition-all transform shadow-lg border border-[var(--border-color)] rounded-lg mr-0 ml-4 mb-2"
         role="dialog" aria-modal="true" style="max-height: 66vh;"
       >
           <div class="overflow-y-auto overscroll-contain p-2 flex-1" style="max-height: calc(66vh - 0px);">
             <div class="space-y-1">
               {#each availableActions as action, index}
                 <button
                   class="w-full text-left p-3 rounded border-none transition-colors flex items-center gap-3 {selectedActionIndex === index ? 'bg-[var(--bg-selected)] focus:outline-none' : 'hover:bg-[var(--bg-hover)]'}"
                   on:click={() => handleActionSelect(action.id)} data-index={index} tabindex="0"
                 >
                   <div class="flex-1 min-w-0">
                     <div class="font-medium text-[var(--text-primary)] break-words">{action.label}</div>
                     {#if action.description}
                       <div class="text-sm text-[var(--text-secondary)] break-words">{action.description}</div>
                     {/if}
                   </div>
                 </button>
               {/each}
               <div class="h-2"></div>
             </div>
           </div>
       </div>
    </div>
  {/if}

  <div class="fixed bottom-0 left-0 right-0 z-30">
    <ActionPanel actions={actionPanelActions} on:action={handleActionPanelAction} />
  </div>
</div>
<style global>
  body { overflow: hidden; height: 100vh; margin: 0; padding: 0; }
  body.action-drawer-open .result-item { pointer-events: none; opacity: 0.7; }
  body.action-drawer-open .result-item:focus,
  body.action-drawer-open [tabindex="0"]:focus,
  body.action-drawer-open .action-drawer button:focus {
      outline: none !important;
      box-shadow: none !important;
      ring-width: 0 !important;
  }
  /* Scrollbar styles */
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background-color: var(--scrollbar-thumb, rgba(155, 155, 155, 0.5)); border-radius: 8px; }
</style>