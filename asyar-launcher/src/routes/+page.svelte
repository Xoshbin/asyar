<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
import ExtensionIframe from '../components/extension/ExtensionIframe.svelte';
  import { searchQuery } from '../services/search/stores/search';
  import { logService } from '../services/log/logService';
  // Import stores directly
  import { selectedIndex, isSearchLoading, isActionDrawerOpen, extensionHasInputFocus, isCapturingShortcut } from '../services/ui/uiStateStore';
  import { invoke } from '@tauri-apps/api/core';
  import SearchHeader from '../components/layout/SearchHeader.svelte';
  import { ResultsList } from '../components';
  import BottomActionBar from '../components/layout/BottomActionBar.svelte'; // Import new component
  import extensionManager, { isReady as isExtensionManagerReady, activeView, activeViewSearchable } from '../services/extension/extensionManager'; // Import isReady
  import { applicationService } from '../services/application/applicationsService';
  import { actionService } from '../services/action/actionService';
  import { performanceService } from '../services/performance/performanceService';
  import { ClipboardHistoryService } from '../services/clipboard/clipboardHistoryService';
  import type { SearchResult } from '../services/search/interfaces/SearchResult';
  import type { ExtensionResult } from 'asyar-sdk';
  import { searchService } from '../services/search/SearchService';
  import { appInitializer } from '../services/appInitializer';
  import { ActionContext } from 'asyar-sdk';
  import { isBuiltInExtension } from '../services/extension/extensionDiscovery';
  import { settingsService } from '../services/settings/settingsService';
  import { portalStore, type Portal } from '../built-in-extensions/portals/portalStore';
  import { shortcutService } from '../built-in-extensions/shortcuts/shortcutService';
  import { shortcutStore, type ItemShortcut } from '../built-in-extensions/shortcuts/shortcutStore';
  import ShortcutCapture from '../built-in-extensions/shortcuts/ShortcutCapture.svelte';
  import '../resources/styles/style.css';

  // Removed global assignments and corresponding imports for Svelte, SvelteStore, SvelteTransition, AsyarApi

  let searchInput: HTMLInputElement;
  let listContainer: HTMLDivElement;
  let currentError: string | null = null; // State for displaying errors
  let bottomActionBarInstance: BottomActionBar; // Instance for the new bar
  let searchItems: SearchResult[] = [];
  let localSearchValue = $searchQuery;
  let lastActiveViewId: string | null = null;
  let activePortal: Portal | null = null;
  let portalQuery = '';
  let portalHint: Portal | null = null; // non-committed hint shown inline
  let assignShortcutTarget: SearchResult | null = null;
  // --- Reactive Statements ---

  $: localSearchValue = $searchQuery;

  // Removed reactive block calling loadView



  $: if (!$activeView && localSearchValue !== undefined) {
    const match = detectPortalMatch(localSearchValue);
    if (match) {
      // Full trigger typed + space → enter portal mode
      activePortal = match.portal;
      portalQuery = match.query;
      portalHint = null;
      handleSearch(match.query || match.portal.name);
    } else {
      activePortal = null;
      portalQuery = '';
      // Check for hint (partial unique prefix, no commitment)
      portalHint = detectPortalHint(localSearchValue);
      handleSearch(localSearchValue);
    }
  } else if ($activeView && $activeViewSearchable && localSearchValue !== undefined) {
     logService.debug(`Search in extension: "${localSearchValue}"`);
     extensionManager.handleViewSearch(localSearchValue);
  }

  $: if (searchItems) { // Reset selected index when search results change
    $selectedIndex = searchItems.length > 0 ? 0 : -1;
  }

  $: { // Action Context - Set based on whether a view is active
    const currentView = $activeView;

    // When leaving an extension view, clean up its registered actions
    if (lastActiveViewId !== null && currentView === null) {
      const closedExtensionId = lastActiveViewId.split('/')[0];
      actionService.clearActionsForExtension(closedExtensionId);
      logService.debug(`[Page] Cleared actions for closed extension: ${closedExtensionId}`);
    }

    lastActiveViewId = currentView;
    actionService.setContext(currentView ? ActionContext.EXTENSION_VIEW : ActionContext.CORE);
   }

   // Map search results for the ResultsList component and get original for BottomBar
   let searchResultItemsMapped: Array<any> = []; // Define type more specifically if possible
   let currentSelectedItemOriginal: SearchResult | null = null;

   $: {
       let baseItems: typeof searchItems = searchItems;
       if (activePortal) {
         const portalResult: SearchResult = {
           objectId: `cmd_portals_${activePortal.id}`,
           name: activePortal.name,
           type: 'command' as const,
           score: 1.0,
           icon: activePortal.icon,
           extensionId: 'portals',
         };
         baseItems = [portalResult, ...searchItems.filter(r => r.objectId !== `cmd_portals_${activePortal!.id}`)];
       }
       const shortcutMap = new Map<string, ItemShortcut>($shortcutStore.map((s: ItemShortcut) => [s.objectId, s]));
      searchResultItemsMapped = baseItems.map(result => {
           const objectId = result.objectId;
           const name = result.name || 'Unknown Item';
           const type = result.type || 'unknown';
           const score = result.score || 0;
           const path = result.path;
           const extensionAction = result.action; // Original action from SearchResult if any

           let icon = result.icon ?? '🧩';
           if (!result.icon) {
               if (type === 'application') icon = '🖥️';
               else if (type === 'command') icon = '❯_';
           }

           // Define actionFunction directly within each block, ensuring it returns Promise<any>
           let actionFunction: () => Promise<any>;

           if (typeof extensionAction === 'function') {
               // If the original SearchResult had a function, wrap it
               const originalExtAction = extensionAction;
               actionFunction = async () => {
                   logService.debug(`Executing direct extension action for ${name}`);
                   try {
                       // Add explicit check here
                       if (typeof originalExtAction === 'function') {
                          await Promise.resolve(originalExtAction());
                       } else {
                          // This case shouldn't happen due to the outer check, but good for safety
                          logService.error(`originalExtAction is not a function for ${name}`);
                          currentError = `Action is invalid for ${name}`;
                       }
                   } catch (err) {
                       logService.error(`Direct extension action failed: ${err}`);
                       currentError = `Action failed for ${name}`;
                       throw err; // Re-throw
                   }
               };
           } else if (type === 'application' && path) {
               actionFunction = async () => {
                   logService.debug(`Calling applicationService.open for ${name} (ID: ${objectId}, Path: ${path})`);
                   try {
                       await applicationService.open({ objectId, name, path, score, type });
                   } catch (err) {
                       logService.error(`applicationService.open failed: ${err}`);
                       currentError = `Failed to open ${name}`;
                       throw err; // Re-throw to be caught by handleEnterKey if needed
                   }
               };
           } else if (type === 'command' && objectId) {
               const commandObjectId = objectId;
               const capturedQuery = (activePortal && objectId === `cmd_portals_${activePortal.id}`)
                 ? portalQuery
                 : localSearchValue;
               actionFunction = async () => {
                   logService.debug(`[+page.svelte] Selected item is a command. Calling extensionManager.handleCommandAction with ID: ${commandObjectId}`); // Added log
                   try {
                       await extensionManager.handleCommandAction(commandObjectId, { query: capturedQuery });
                   } catch (err) {
                       logService.error(`extensionManager.handleCommandAction failed: ${err}`);
                       currentError = `Failed to run command ${name}`;
                       throw err; // Re-throw
                   }
               };
           } else {
               // Fallback: Define a default async function that does nothing but log
               actionFunction = async () => {
                   logService.warn(`No valid action defined or executable for item: ${name} (${type})`);
                   currentError = `No action for ${name}`;
                   // No need to throw here, just resolve
                   return Promise.resolve();
               };
           }

           const finalObjectId = typeof objectId === 'string' && objectId ? objectId : `fallback_id_${Math.random()}`;
           if (finalObjectId.startsWith('fallback')) {
               logService.warn(`Result item missing/invalid objectId: ${name} ${type}`);
           }

           let typeLabelStr = type ? type.charAt(0).toUpperCase() + type.slice(1) : undefined;
           if (type === 'command' && result.extensionId) {
               const manifest = extensionManager.getManifestById?.(result.extensionId);
               if (manifest && manifest.name) {
                   typeLabelStr = manifest.name;
               }
           }

           return {
               object_id: finalObjectId,
               title: name,
               subtitle: result.description || undefined,
               typeLabel: typeLabelStr,
               icon: icon,
               score: score,
               action: actionFunction, 
               style: result.style,
               shortcut: shortcutMap.get(finalObjectId)?.shortcut
           };
       });

       // Update original selected item based on the index
       currentSelectedItemOriginal = ($selectedIndex >= 0 && $selectedIndex < baseItems.length)
           ? baseItems[$selectedIndex]
           : null;
   }

   // Register/unregister shortcut assignment action
   $: {
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
   }
   
   async function handleShortcutCapture(shortcut: string) {
     if (assignShortcutTarget) {
       await shortcutService.register(
         assignShortcutTarget.objectId,
         assignShortcutTarget.name,
         // Ensure it's treated as application or command
         (assignShortcutTarget.type === 'application' || assignShortcutTarget.type === 'command') ? assignShortcutTarget.type : 'command', 
         shortcut,
         assignShortcutTarget.path
       );
     }
     assignShortcutTarget = null;
     restoreSearchFocus();
   }
   $: if (listContainer && $selectedIndex >= 0) { // Scroll Logic
     requestAnimationFrame(() => {
         const selectedElement = listContainer.querySelector(`[data-index="${$selectedIndex}"]`);
         if (selectedElement) {
           selectedElement.scrollIntoView({ block: 'nearest' });
         }
     });
   }

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

  function restoreSearchFocus() {
    setTimeout(() => {
      searchInput?.focus({ preventScroll: true });
    }, 50);
  }

  function isInputFocused(): boolean {
    if ($extensionHasInputFocus) return true;
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    // Standard text-entry elements
    if (tag === 'textarea') return true;
    if (tag === 'select') return true;
    if (tag === 'input') {
      const type = (el as HTMLInputElement).type?.toLowerCase() ?? 'text';
      // These input types accept keyboard text — backspace/escape must not be stolen
      const textTypes = ['text', 'search', 'email', 'password', 'number', 'tel', 'url', 'date', 'time', 'datetime-local', 'month', 'week'];
      return textTypes.includes(type);
    }
    // contenteditable
    if ((el as HTMLElement).isContentEditable) return true;
    return false;
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    // Let ShortcutCapture own all keyboard input when active (covers both search-context and DefaultView paths)
    if ($isCapturingShortcut) return;

    // Tab commits the portal hint into full portal mode
    if (event.key === 'Tab' && portalHint !== null && !activePortal && !$activeView) {
      event.preventDefault();
      const trigger = portalHint.name;
      activePortal = portalHint;
      portalQuery = '';
      portalHint = null;
      localSearchValue = trigger + ' ';
      searchQuery.set(trigger + ' ');
      return;
    }

    // Exit portal mode on Backspace with empty query
    if (event.key === 'Backspace' && activePortal !== null && portalQuery === '') {
      event.preventDefault();
      handlePortalDismiss(false);
      return;
    }

    // Cmd/Ctrl+K handler
    if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      bottomActionBarInstance?.toggleActionList();
      // Focus restoration is handled by the actionListClosed event from BottomActionBar
      return;
    }

    // If the action panel is open, always close it first — regardless of active view
    if (['Escape', 'Backspace', 'Delete'].includes(event.key) && bottomActionBarInstance?.isOpen()) {
      bottomActionBarInstance.closeActionList();
      event.preventDefault();
      return;
    }

    // Handle keys relevant to the main page when a view is active
     if ($activeView && ['Escape', 'Backspace', 'Delete'].includes(event.key)) {
         if (!event.defaultPrevented) {
             if (isInputFocused() && document.activeElement !== searchInput) {
                 if (event.key === 'Escape') {
                     (document.activeElement as HTMLElement)?.blur();
                     searchInput?.focus({ preventScroll: true });
                     event.preventDefault();
                 }
                 return; // Do NOT navigate for Backspace/Delete in an input
             }
             handleKeydown(event);
         }
     } else if ($activeView) {
         const forwardKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab'];
         if (forwardKeys.includes(event.key)) {
           extensionManager.forwardKeyToActiveView({
             key: event.key,
             shiftKey: event.shiftKey,
             ctrlKey: event.ctrlKey,
             metaKey: event.metaKey,
             altKey: event.altKey,
           });
           event.preventDefault();
         }
         return;
     }

    // Focus handling is managed reactively and on specific events
  }

  // Maintain focus function
  function maintainSearchFocus(e: MouseEvent) {
     const target = e.target as HTMLElement;
     
     // NEVER steal focus from these elements
     if (isInputFocused() && document.activeElement !== searchInput) return;
     
     const tag = target.tagName.toLowerCase();
     const inputTypes = ['text', 'search', 'email', 'password', 'number', 'tel', 'url', 'date', 'time', 'datetime-local', 'month', 'week'];
     
     if (tag === 'textarea') return;
     if (tag === 'select') return;
     if (tag === 'input' && inputTypes.includes((target as HTMLInputElement).type?.toLowerCase())) return;
     if ((target as HTMLElement).isContentEditable) return;
     if (target.closest('.action-list-popup, .bottom-action-bar, [data-no-focus-steal]')) return;
     
     // For everything else, return focus to search after a tick
     requestAnimationFrame(() => {
       if (!isInputFocused() && searchInput) {
         searchInput.focus({ preventScroll: true });
       }
     });
  }

  let globalKeydownListenerActive = false;
  $: {
    if (!globalKeydownListenerActive && typeof window !== 'undefined') {
      window.addEventListener('keydown', handleGlobalKeydown, true);
      globalKeydownListenerActive = true;
    }
  }

  function handleSearchInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    localSearchValue = value;
    searchQuery.set(value);
    currentError = null; // Clear error on new input
  }

  // Main keydown handler for the search input (when no view is active)
  function handleKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented) return;

    // Escape: Handled in handleGlobalKeydown if popup isn't open
    if (event.key === 'Escape') {
      if (isInputFocused() && document.activeElement !== searchInput) {
        (document.activeElement as HTMLElement)?.blur();
        searchInput?.focus({ preventScroll: true });
        event.preventDefault();
        return;
      }

      event.preventDefault();
      if ($activeView) {
        const escapeBehavior = settingsService.getSettings()?.general?.escapeInViewBehavior || 'close-window';
        if (escapeBehavior === 'go-back') {
          extensionManager.goBack();
        } else {
          invoke('hide');
        }
      } else {
        invoke('hide');
      }
      return;
    }

    // Backspace/Delete in View: Handled in handleGlobalKeydown
    if ($activeView && (event.key === 'Backspace' || event.key === 'Delete') && searchInput?.value === '') {
      if (isInputFocused() && document.activeElement !== searchInput) return;
      
      // If the action panel is open, close it instead of navigating back
      if (bottomActionBarInstance?.isOpen()) {
        bottomActionBarInstance.closeActionList();
        event.preventDefault();
        return;
      }

      event.preventDefault();
      extensionManager.goBack();
      return;
    }

    // Navigation/Enter (Only when no view is active)
    if (!$activeView) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const totalItems = searchResultItemsMapped.length;
        if (totalItems === 0) return;
        let newIndex = $selectedIndex;
        newIndex = (event.key === 'ArrowDown')
            ? ($selectedIndex + 1) % totalItems
            : ($selectedIndex - 1 + totalItems) % totalItems;
        $selectedIndex = newIndex;
        currentError = null; // Clear error on navigation
      }
      else if (event.key === 'Enter') {
         event.preventDefault();
        handleEnterKey();
      }
    }

     // Prevent default browser scroll for arrows if search input is focused
     if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && document.activeElement === searchInput) {
         event.preventDefault();
     }
  }

  function handleBackClick() {
    if ($activeView) {
      extensionManager.goBack();
    }
  }

  // Removed loadView function as its logic is now integrated into the reactive block above

  // Committed match: full portal name typed (exact or name + space + query)
  function detectPortalMatch(text: string): { portal: Portal, query: string } | null {
    const portals = portalStore.getAll();
    let bestMatch: { portal: Portal, query: string } | null = null;
    const lower = text.toLowerCase();

    for (const portal of portals) {
      const trigger = portal.name.toLowerCase();
      if (lower.startsWith(trigger + ' ')) {
        if (!bestMatch || portal.name.length > bestMatch.portal.name.length) {
          bestMatch = { portal, query: text.slice(portal.name.length + 1) };
        }
      }
    }
    return bestMatch;
  }

  // Hint detection: text is a strict prefix of exactly one portal name (≥2 chars)
  // Only shows a hint — does NOT enter portal mode
  function detectPortalHint(text: string): Portal | null {
    if (text.length < 2) return null;
    const portals = portalStore.getAll();
    const lower = text.toLowerCase();
    // Must be a strict prefix (not an exact match — exact is handled by commit logic)
    const matches = portals.filter(p => {
      const trigger = p.name.toLowerCase();
      return trigger.startsWith(lower) && trigger !== lower;
    });
    // Show hint only when exactly one portal matches the prefix
    if (matches.length === 1) return matches[0];
    return null;
  }

  function handlePortalDismiss(clearAll = false) {
    const trigger = activePortal?.name ?? '';
    activePortal = null;
    portalQuery = '';
    const newValue = clearAll ? '' : trigger.slice(0, -1);
    localSearchValue = newValue;
    searchQuery.set(newValue);
    // Re-focus after the normal <input> mounts (portal input is destroyed)
    tick().then(() => searchInput?.focus());
  }

  function handlePortalQueryChange(e: CustomEvent<{ query: string }>) {
    portalQuery = e.detail.query;
    handleSearch(e.detail.query || (activePortal?.name ?? ''));
  }

  async function handleSearch(query: string) {
    if (!appInitializer.isAppInitialized() || $activeView) return;
    $isSearchLoading = true;
    currentError = null;
    logService.debug(`Starting combined search for query: "${query}"`);
    try {
      const resultsFromRustPromise = searchService.performSearch(query);
      const resultsFromExtensionsPromise = extensionManager.searchAllExtensions(query);
      
      // Fetch fallback suggestions for empty space filling if searching
      let suggestionsPromise: Promise<SearchResult[]> = Promise.resolve([]);
      if (query.trim() !== '') {
          suggestionsPromise = searchService.performSearch('');
      }

      const [resultsFromRust, resultsFromExtensions, suggestions] = await Promise.all([
        resultsFromRustPromise,
        resultsFromExtensionsPromise,
        suggestionsPromise
      ]);

      const mappedExtensionResults: SearchResult[] = resultsFromExtensions.map((extRes: ExtensionResult & { extensionId?: string }) => ({
        objectId: `ext_${extRes.extensionId || 'unknown'}_${extRes.title.replace(/\s+/g, '_')}_${Math.random().toString(36).substring(2, 7)}`,
        name: extRes.title,
        description: extRes.subtitle,
        type: 'command',
        score: extRes.score ?? 0.5,
        path: undefined,
        category: 'extension',
        extensionId: extRes.extensionId,
        icon: extRes.icon,
        style: extRes.style
      }));

      let combinedResults = [...resultsFromRust, ...mappedExtensionResults];
      combinedResults.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

      if (query.trim() !== '') {
         // Filter out suggestions that we've already included
         const existingNames = new Set(combinedResults.map(r => r.name));
         const existingIds = new Set(combinedResults.map(r => r.objectId));
         const filteredSuggestions = suggestions.filter(s => !existingNames.has(s.name) && !existingIds.has(s.objectId));
         
         // Append suggestions to fill up space, say up to 10 total items
         const appendCount = Math.max(0, 10 - combinedResults.length);
         if (appendCount > 0) {
             const itemsToAppend = filteredSuggestions.slice(0, appendCount).map(s => ({ ...s, score: -1.0 }));
             combinedResults = [...combinedResults, ...itemsToAppend];
         }
      }

      searchItems = combinedResults; // Update the raw search items list
    } catch (error) {
      logService.error(`Combined search failed: ${error}`);
      currentError = "Search failed";
      searchItems = [];
    } finally {
      $isSearchLoading = false;
    }
  }



  // --- Lifecycle ---
  onMount(async () => {
    await appInitializer.init();
    if (appInitializer.isAppInitialized()) {
        await handleSearch($searchQuery || '');
    }
    if (searchInput) searchInput.focus();
    // Use capture phase for click listener
    document.addEventListener('click', maintainSearchFocus, true);
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
     document.removeEventListener('click', maintainSearchFocus, true);
   });

</script>

<div class="flex flex-col h-screen">
  <div class="fixed top-0 left-0 right-0 z-[100] bg-[var(--bg-primary)] shadow-md">
    <SearchHeader
      bind:ref={searchInput}
      value={localSearchValue}
      showBack={!!$activeView}
      searchable={!($activeView && !$activeViewSearchable)}
      placeholder={$activeView ? ($activeViewSearchable ? "Search..." : "Press Escape to go back") : "Search or type a command..."}
      activePortal={activePortal}
      portalQuery={portalQuery}
      portalHint={portalHint}
      on:input={handleSearchInput}
      on:keydown={handleKeydown}
      on:click={handleBackClick}
      on:portalDismiss={() => handlePortalDismiss(true)}
      on:portalQueryChange={handlePortalQueryChange}
    />
  </div>
  <!-- Spacer for SearchHeader -->
  <div class="h-[72px] flex-shrink-0"></div>
  <div class="flex-1 overflow-y-auto pb-10"> <!-- Simplified: Removed relative, added overflow and padding -->
    <!-- Main Content Area -->
    {#if $activeView}
      {@const extensionId = $activeView.split('/')[0]}
      {@const viewName = $activeView.split('/')[1] || 'DefaultView'}
      {@const isBuiltIn = isBuiltInExtension(extensionId)}
      {@const manifest = extensionManager.getManifestById ? extensionManager.getManifestById(extensionId) : null}
      {@const module = extensionManager.getLoadedExtensionModule(extensionId)}
      {@const component = isBuiltIn ? (module?.[viewName] ?? module?.default?.[viewName] ?? module?.default) : null}

      <div class="min-h-full flex flex-col flex-1 h-full" data-extension-view={$activeView}>
        {#key extensionId}
          {#if isBuiltIn}
            {#if component}
              <svelte:component this={component} />
            {:else}
              <div class="p-4 text-center text-red-500 font-mono text-sm">
                Error: Built-in extension {extensionId} has no export matching '{viewName}'
              </div>
            {/if}
          {:else}
            <ExtensionIframe
              extensionId={extensionId}
              view={$activeView}
              manifest={manifest}
            />
          {/if}
        {/key}
      </div>
    {:else}
      <!-- Main Search Results / No View Active -->
      <div class="min-h-full flex flex-col">
        <div bind:this={listContainer}>
           {#if $isSearchLoading}
              <div class="p-4 text-center text-[var(--text-secondary)]">Loading...</div>
           {:else if currentError}
               <div class="p-4 text-center text-red-500">{currentError}</div>
           {:else if searchResultItemsMapped.length > 0}
               <ResultsList
                 items={searchResultItemsMapped}
                 selectedIndex={$selectedIndex}
                 on:select={({ detail }: { detail: { item: { object_id: string; title: string; subtitle?: string; action: () => void; } } }) => {
                   const clickedIndex = searchResultItemsMapped.findIndex(item => item.object_id === detail.item.object_id);
                   if (clickedIndex !== -1) {
                       $selectedIndex = clickedIndex;
                       handleEnterKey(); // Execute the action associated with the mapped item
                   } else {
                       logService.warn(`Clicked item not found in current results: ${detail.item?.object_id ?? 'Unknown item clicked'}`);
                   }
                 }}
               />
           {:else if localSearchValue}
               <div class="p-4 text-center text-[var(--text-secondary)]">No results found.</div>
           {/if}
        </div>
      </div> <!-- Closes min-h-full div -->
    {/if} <!-- This closes the #if $activeView block -->
  </div> <!-- Closes flex-1 relative div -->

  <!-- New Bottom Action Bar -->
  <BottomActionBar
    bind:this={bottomActionBarInstance}
    selectedItem={currentSelectedItemOriginal}
    errorState={currentError}
    on:actionListClosed={() => { if (!assignShortcutTarget) restoreSearchFocus(); }}
  />
  
  <!-- Modal Capture Overlay -->
  {#if assignShortcutTarget}
    <ShortcutCapture events={{ capture: handleShortcutCapture, cancel: () => { assignShortcutTarget = null; restoreSearchFocus(); } }} />
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
