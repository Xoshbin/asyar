<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { searchQuery } from '../services/search/stores/search';
  import { logService } from '../services/log/logService';
  import { selectedIndex, isSearchLoading, isActionDrawerOpen, selectedActionIndex } from '../services/ui/uiStateStore'; // Import the new store
  import { invoke } from '@tauri-apps/api/core';
  import SearchHeader from '../components/layout/SearchHeader.svelte';
  import { ResultsList } from '../components'; // Removed ActionPanel import
  import ActionDrawerHandler from '../components/layout/ActionDrawerHandler.svelte'; // Import the new handler
  import extensionManager, { activeView, activeViewSearchable } from '../services/extension/extensionManager';
  import { applicationService } from '../services/application/applicationsService';
  import { actionService, actionStore, ActionContext } from '../services/action/actionService'; // Keep actionStore for unsubscribe if needed, or remove if fully handled
  import { performanceService } from '../services/performance/performanceService';
  import type { ApplicationAction } from '../services/action/actionService';
  import { ClipboardHistoryService } from '../services/clipboard/clipboardHistoryService';
  import type { SearchResult } from '../services/search/interfaces/SearchResult';
  import { searchService } from '../services/search/SearchService';
  import { appInitializer } from '../services/appInitializer'; // Import the new initializer

  let searchInput: HTMLInputElement;
  let listContainer: HTMLDivElement;
  let loadedComponent: any = null;
  let actionDrawerHandlerInstance: ActionDrawerHandler; // Add instance variable
  // Removed: let isInitialized = false;
  let searchItems: SearchResult[] = [];
  // Removed: let isSearchLoading = false;
  // Removed: let selectedIndex = -1;
  let localSearchValue = $searchQuery;

  $: localSearchValue = $searchQuery;
  $: if ($activeView) {
    loadView($activeView);
    $selectedIndex = -1; // Reset selection when entering a view
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
    $selectedIndex = searchItems.length > 0 ? 0 : -1;
  }

  $: { // Action Context
    actionService.setContext($activeView ? ActionContext.EXTENSION_VIEW : ActionContext.CORE);
  }

   $: { // Maintain Focus - Refocus input when drawer closes
     if (searchInput && !$isActionDrawerOpen) {
       // Use a slight delay to ensure focus happens after drawer transition/cleanup
       setTimeout(() => {
         const activeEl = document.activeElement;
         // Only refocus if the drawer is *still* closed and focus isn't already on the input
         // or another interactive element outside the drawer context.
         if (!$isActionDrawerOpen && searchInput && activeEl !== searchInput) {
            // Check if the active element is something we generally want to keep focus on
            // (e.g., not another input, button, link etc.)
            if (!isActiveElementInteractive() || activeEl === document.body || !activeEl) {
                 searchInput.focus();
                 // Move cursor to end after focusing
                 searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
            }
         } else if (!$isActionDrawerOpen && searchInput && !activeEl) {
            // If nothing is focused and drawer is closed, focus input
            searchInput.focus();
         }
       }, 50); // Delay slightly
     }
   }

   $: if (listContainer && $selectedIndex >= 0) { // Scroll Logic - Use store value
     requestAnimationFrame(() => {
         const selectedElement = listContainer.querySelector(`[data-index="${$selectedIndex}"]`); // Use store value
         if (selectedElement) {
           selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
         }
     });
   }


   $: searchResultItems = searchItems.map(result => {
    const objectId = result.objectId; // Use correct case based on your logs/interface
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
        applicationService.open({ objectId, name, path, score, type })
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
        logService.warn(`Result item missing/invalid objectId: ${name} ${type}`);
    }

     return {
      object_id: finalObjectId, // Use consistent ID for internal Svelte list/keys
      title: name,
      subtitle: type,
      icon: icon,
      score: score,
      action: actionFunction
    };
  });


  async function handleEnterKey() {
     if ($selectedIndex < 0 || $selectedIndex >= searchResultItems.length) { // Use store value
         logService.warn(`Enter pressed with invalid selectedIndex: ${$selectedIndex}`); // Use store value
         return;
     }
     const selectedItem = searchResultItems[$selectedIndex]; // Use store value
     if (!selectedItem) {
         logService.error(`Could not find item at selectedIndex: ${$selectedIndex}`); // Use store value
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
    // Re-add Cmd/Ctrl+K handler to call the child component's toggle method
    if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      actionDrawerHandlerInstance?.toggle(); // Call toggle on the instance
      return;
    }

    if ($isActionDrawerOpen) return; // Use store value

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
    if (!$isActionDrawerOpen && searchInput && document.activeElement !== searchInput && !isActiveElementInteractive()) { // Use store value
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
      // If drawer is open, the ActionDrawerHandler's captureAllKeydowns will handle it.
      // This logic now only applies when the drawer is closed.
      if (!$isActionDrawerOpen && $activeView) {
        logService.debug(`Escape pressed in view, returning to main screen`);
        extensionManager.closeView();
      } else if (!$isActionDrawerOpen && !$activeView) {
        logService.debug(`Escape pressed in main view, hiding app`);
        invoke('hide');
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

        let newIndex = $selectedIndex; // Use store value
        if (event.key === 'ArrowDown') {
          newIndex = ($selectedIndex + 1) % totalItems; // Use store value
        } else { // ArrowUp
          newIndex = ($selectedIndex - 1 + totalItems) % totalItems; // Use store value
        }
        $selectedIndex = newIndex; // Update store value
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
      
      // Check if it's a built-in extension first
      let module;
      try {
        module = await import(`../built-in-extensions/${extensionName}/${componentName}.svelte`);
        logService.debug(`Loaded built-in extension view: ${viewPath}`);
      } catch (e) {
        // If not found in built-in, try regular extensions
        module = await import(`../extensions/${extensionName}/${componentName}.svelte`);
        logService.debug(`Loaded regular extension view: ${viewPath}`);
      }
      
      if (!module.default) throw new Error('View component not found in module');
      loadedComponent = module.default;
      logService.debug(`Successfully loaded view component for ${viewPath}`);
      // Focus search input after loading view, maybe with delay
      setTimeout(() => searchInput?.focus(), 50);
    } catch (error) {
      logService.error(`Failed to load view ${viewPath}: ${error}`);
      extensionManager.closeView(); // Reset on error
    }
  }

  async function handleSearch(query: string) {
    // Use appInitializer to check if ready
    if (!appInitializer.isAppInitialized() || $activeView) {
      return;
    }
    $isSearchLoading = true; // Use store value
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
      $isSearchLoading = false; // Use store value
    }
  }

  // Function to ensure search input keeps focus (simplified)
  function maintainSearchFocus(e: MouseEvent) {
     // Allow clicks on interactive elements (buttons, links, inputs, etc.)
     const target = e.target as HTMLElement;
     const isInteractive = target.closest('button, a, input, select, textarea, [role="button"], [role="link"], .result-item');

     if (!isInteractive && searchInput && document.activeElement !== searchInput && !$activeView && !$isActionDrawerOpen) { // Use store value
         setTimeout(() => {
             searchInput.focus();
             // Move cursor to end
             searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
         }, 10); // Small delay
     }
  }


  // Simplified onMount using appInitializer
  onMount(async () => {
    await appInitializer.init();

    // Perform initial search only after initialization is confirmed successful
    if (appInitializer.isAppInitialized()) {
        await handleSearch($searchQuery || '');
    }

    // Component-specific setup
    if (searchInput) searchInput.focus();
    document.addEventListener('click', maintainSearchFocus);

    // Ensure global keydown listener is added (idempotent check inside handleGlobalKeydown logic)
    if (!globalKeydownListenerActive && typeof window !== 'undefined') {
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
     // Removed unsubscribeActions() - Handled in ActionDrawerHandler
     // Removed document.removeEventListener('keydown', captureAllKeydowns, true); - Handled in ActionDrawerHandler
   });


  // --- Action Drawer state and functions ---
  // All Action Drawer state and functions moved to ActionDrawerHandler.svelte
  // Removed: actionDrawerRef, actionButtons, availableActions, actionPanelActions
  // Removed: unsubscribeActions (now handled in child component)
  // Removed: handleActionPanelAction, toggleActionDrawer, captureAllKeydowns, handleActionKeydown, focusSelectedAction, handleActionSelect

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
             {#if $isSearchLoading}
                <div class="p-4 text-center text-[var(--text-secondary)]">Loading...</div>
             {:else if searchResultItems.length > 0}
                 <ResultsList
                   items={searchResultItems}
                   selectedIndex={$selectedIndex}
                   on:select={({ detail }: { detail: { item: { object_id: string } } }) => {
                     const clickedIndex = searchResultItems.findIndex(item => item.object_id === detail.item.object_id);
                     if (clickedIndex !== -1) {
                         $selectedIndex = clickedIndex;
                         handleEnterKey();
                     } else {
                         logService.warn(`Clicked item not found in current results: ${detail.item?.object_id ?? 'Unknown item clicked'}`);
                     }
                   }}
                 />
             {:else}
                 {#if localSearchValue && !$isSearchLoading}
                     <div class="p-4 text-center text-[var(--text-secondary)]">No results found.</div>
                 {/if}
             {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>

  <!-- Action Drawer and Panel are now handled by ActionDrawerHandler -->
  <ActionDrawerHandler bind:this={actionDrawerHandlerInstance} />

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
