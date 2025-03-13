<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { searchQuery, searchResults } from '../stores/search';
  import { logService } from '../services/logService';
  import { invoke } from '@tauri-apps/api/core';
  import SearchHeader from '../components/layout/SearchHeader.svelte';
  import { ResultsList, ActionPanel } from '../components';
  import { fuzzySearch } from '../utils/fuzzySearch';
  import extensionManager, { activeView, activeViewSearchable } from '../services/extensionManager';
  import { applicationService } from '../services/applicationsService';
  import { ClipboardHistoryService } from '../services/clipboardHistoryService';
  import { actionService, actionStore } from '../services/actionService';
  import type { ApplicationAction } from '../services/actionService';

  let searchInput: HTMLInputElement;
  let localSearchValue = '';
  let listContainer: HTMLDivElement;
  let loadedComponent: any = null;
  
  // Cache for all applications and extensions
  let allApplications: any[] = [];
  let allExtensions: any[] = [];
  let isInitialized = false;
  
  // Sync local value with store
  $: localSearchValue = $searchQuery;
  
  // Watch for activeView changes
  $: if ($activeView) {
    loadView($activeView);
  }

  // Watch for search query changes
  $: if (!$activeView) {
    handleSearch($searchQuery);
  }
  
  // Force focus after navigation with delay and keep focus when typing
  $: {
    if (searchInput && !isActionDrawerOpen) {
      // Always try to refocus the search input with a small delay to ensure DOM is updated
      setTimeout(() => {
        if (searchInput && (!document.activeElement || document.activeElement !== searchInput)) {
          searchInput.focus();
          searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
        }
      }, 10);
    }
  }

  // Global keydown handler - modify to be less aggressive when extensions are active
  function handleGlobalKeydown(event: KeyboardEvent) {
    // Handle Cmd+K / Ctrl+K shortcut to open action drawer regardless of context
    if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      toggleActionDrawer();
      return;
    }

    // If action drawer is open, defer to its own keyboard handler
    if (isActionDrawerOpen) {
      return;
    }

    // If we're in an extension view, let the extension handle arrow keys and Enter
    if ($activeView && (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Enter')) {
      return;
    }
    
    // Re-focus search input if it loses focus but don't steal focus from interactive elements
    if (!isActionDrawerOpen && 
        searchInput && 
        document.activeElement !== searchInput &&
        !isActiveElementInteractive()) {
      searchInput.focus();
    }
  }
  
  // Helper to check if the current active element is an interactive element
  function isActiveElementInteractive(): boolean {
    const activeElement = document.activeElement;
    if (!activeElement) return false;
    
    // Check if element is interactive
    const nodeName = activeElement.nodeName.toLowerCase();
    const isInteractive = [
      'a', 'button', 'input', 'select', 'textarea', 'details',
      'iframe', 'audio', 'video'
    ].includes(nodeName);
    
    // Check for role attributes
    const role = activeElement.getAttribute('role');
    const hasInteractiveRole = role && [
      'button', 'checkbox', 'combobox', 'menuitem', 'menuitemcheckbox',
      'menuitemradio', 'option', 'radio', 'slider', 'switch', 'tab'
    ].includes(role);
    
    // Check if element is in an extension container
    const isInExtensionView = $activeView && 
      (activeElement.closest(`[data-extension-view="${$activeView}"]`) !== null ||
       activeElement.hasAttribute('tabindex'));
    
    return isInteractive || hasInteractiveRole || isInExtensionView;
  }

  // Keep the global keydown listener always active
  let globalKeydownListenerActive = false;
  
  $: {
    // Always have the global keydown listener, regardless of view state
    if (!globalKeydownListenerActive) {
      window.addEventListener('keydown', handleGlobalKeydown, true);
      globalKeydownListenerActive = true;
      logService.debug(`Added global keydown listener`);
    }
  }
  
  // Handle search input changes
  function handleSearchInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    localSearchValue = value;
    searchQuery.set(value);
    
    // Only update search in extension view
    if ($activeView && $activeViewSearchable) {
      logService.debug(`Search in extension: "${value}"`);
      extensionManager.handleViewSearch(value);
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    // Handle Escape key
    if (event.key === 'Escape') {
      event.preventDefault();
      if (isActionDrawerOpen) {
        isActionDrawerOpen = false;
      } else if ($activeView) {
        // If in extension view, return to main screen
        logService.debug(`Escape pressed, returning to main screen`);
        extensionManager.closeView();
      } else {
        // If in main view, hide the app
        logService.debug(`Escape pressed in main view, hiding app`);
        invoke('hide');
      }
      return;
    }

    // Handle Backspace/Delete ONLY when the search is already empty
    if ($activeView && 
        (event.key === 'Backspace' || event.key === 'Delete') && 
        searchInput?.value === '') {
      // Only navigate back when pressing delete/backspace on already empty field
      event.preventDefault(); // Prevent the default behavior
      logService.debug(`Backspace/Delete on empty input, returning to main screen`);
      extensionManager.closeView();
      return;
    }
    
    // Only for main view navigation
    if (!$activeView) {
      // Main view keyboard navigation
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        
        const totalItems = $searchResults.extensions.length + $searchResults.applications.length;
        if (totalItems === 0) return;
        
        const newIndex = event.key === 'ArrowDown'
          ? ($searchResults.selectedIndex + 1) % totalItems
          : ($searchResults.selectedIndex - 1 < 0 ? totalItems - 1 : $searchResults.selectedIndex - 1);

        searchResults.update(state => ({ ...state, selectedIndex: newIndex }));
      } 
      else if (event.key === 'Enter') {
        handleEnterKey();
      }
    }
    // Don't capture up/down arrow keys for any extension views
    else if ($activeView && (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Enter')) {
      // Let the event bubble up to the extension component
      return;
    }
  }
  
  function handleEnterKey() {
    const totalItems = $searchResults.extensions.length + $searchResults.applications.length;
    if (totalItems === 0) return;
    
    if ($searchResults.selectedIndex < $searchResults.extensions.length) {
      const selectedExtension = $searchResults.extensions[$searchResults.selectedIndex];
      selectedExtension.action();
    } else {
      const selectedApp = $searchResults.applications[
        $searchResults.selectedIndex - $searchResults.extensions.length
      ];
      applicationService.open(selectedApp);
    }
  }
  
  function handleBackClick() {
    if ($activeView) {
      logService.debug(`Back button clicked, returning to main screen`);
      extensionManager.closeView();
    }
  }
  
  async function loadView(viewPath: string) {
    try {
      logService.debug(`Loading view for path: ${viewPath}`);
      // Split viewPath to handle both extension and view components
      const [extensionName, componentName] = viewPath.split('/');
      
      const module = await import(`../extensions/${extensionName}/${componentName}.svelte`);
      logService.debug(`View module loaded: ${JSON.stringify(module)}`);
      
      if (!module.default) {
        throw new Error('View component not found in module');
      }
      
      loadedComponent = module.default;
      logService.debug(`Successfully loaded view component`);
    } catch (error) {
      logService.error(`Failed to load view ${viewPath}: ${error}`);
      // Reset view on error
      extensionManager.closeView();
    }
  }

  async function handleSearch(query: string) {
    // logService.debug(`Searching with query: "${query}"`);
    
    try {
      // For complete initialization or empty queries, ensure we have cached data
      if (!isInitialized || !query || query.trim() === "") {
        if (allApplications.length === 0) {
          allApplications = await applicationService.getAllApplications();
        }
        
        if (allExtensions.length === 0) {
          allExtensions = await extensionManager.getAllExtensions();
        }
        isInitialized = true;
      }

      let extensions = [];
      let apps = [];

      // For short queries, use the cached data with fuzzy search
      if (!query || query.trim().length < 2) {
        extensions = allExtensions;
        apps = allApplications;
      } else {
        // For specific queries, use direct search from services
        [apps, extensions] = await Promise.all([
          applicationService.search(query),
          extensionManager.searchAll(query)
        ]);
        
        // If direct search doesn't return enough results, supplement with fuzzy search
        if (extensions.length === 0) {
          extensions = fuzzySearch(allExtensions, query, {
            keys: ['title', 'subtitle', 'keywords'],
            threshold: 0.4
          });
        }
      }
      
      searchResults.set({
        extensions,
        applications: apps,
        selectedIndex: 0
      });
    } catch (error) {
      logService.error(`Search failed: ${error}`);
    }
  }

  // Function to ensure search input keeps focus
  function maintainSearchFocus(e: MouseEvent) {
    // Check if the click was on an input, button or interactive element
    const isInteractiveElement = (e.target as HTMLElement)?.tagName === 'INPUT' || 
                               (e.target as HTMLElement)?.tagName === 'BUTTON' ||
                               (e.target as HTMLElement)?.closest('button') ||
                               (e.target as HTMLElement)?.closest('[role="button"]') ||
                               (e.target as HTMLElement)?.closest('.result-item');
    
    // Don't interfere with interactive elements
    if (isInteractiveElement) return;
    
    if (searchInput && document.activeElement !== searchInput && $activeView && !isActionDrawerOpen) {
      // Small delay to allow other click handlers to execute first
      setTimeout(() => {
        searchInput.focus();
        // Don't move cursor if input has text selected
        if (!searchInput.selectionStart || searchInput.selectionStart === searchInput.selectionEnd) {
          searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
        }
      }, 50);
    }
  }

  $: if (listContainer && $searchResults.selectedIndex >= 0) {
    const selectedElement = listContainer.querySelector(`[data-index="${$searchResults.selectedIndex}"]`);
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: 'nearest' });
    }
  }

  onMount(async () => {
    // logService.info(`Application starting...`);
    const clipboardHistoryService = ClipboardHistoryService.getInstance();
    await clipboardHistoryService.initialize();
    logService.info(`Clipboard history service initialized at app startup`);
    
    try {
      // Cache all applications and extensions for fuzzy search
      allApplications = await applicationService.getAllApplications();
      await extensionManager.loadExtensions();
      allExtensions = await extensionManager.getAllExtensions();
      isInitialized = true;
      
      // logService.info(`Cache and extensions loaded successfully`);
      await handleSearch($searchQuery);
      
      // Focus input on mount
      if (searchInput) {
        searchInput.focus();
      }
      
      // Add a click handler to maintain search input focus
      document.addEventListener('click', maintainSearchFocus);
    } catch (error) {
      logService.error(`Failed to initialize: ${error}`);
    }

    // Ensure keyboard listener is set up on mount
    if (!globalKeydownListenerActive) {
      window.addEventListener('keydown', handleGlobalKeydown, true);
      globalKeydownListenerActive = true;
    }
  });

  onDestroy(() => {
    // Always clean up the global event listener
    if (globalKeydownListenerActive) {
      window.removeEventListener('keydown', handleGlobalKeydown, true);
      globalKeydownListenerActive = false;
    }
    document.removeEventListener('click', maintainSearchFocus);
    if (unsubscribeActions) unsubscribeActions();
    
    // Clean up the capturing event listener if active
    if (isActionDrawerOpen) {
      document.removeEventListener('keydown', captureAllKeydowns, true);
    }
  });

  // Transform items for ResultsList
  $: extensionItems = $searchResults.extensions.map(result => ({
    title: result.title,
    subtitle: result.subtitle || (result.score !== undefined ? `Match score: ${Math.round((1 - result.score) * 100)}%` : ''),
    action: result.action
  }));

  $: applicationItems = $searchResults.applications.map(app => ({
    title: app.name,
    subtitle: app.path || (app.score !== undefined ? `Match score: ${Math.round((1 - app.score) * 100)}%` : ''),
    action: () => applicationService.open(app)
  }));

  // Action drawer state
  let isActionDrawerOpen = false;
  let selectedActionIndex = 0;
  let actionDrawerRef: HTMLElement;
  let actionButtons: HTMLButtonElement[] = [];
  
  // Actions from the action service
  let availableActions: ApplicationAction[] = [];

  // Action panel configuration - only the actions button
  let actionPanelActions = [
    { id: 'actions', label: '⌘ K Actions', icon: '' }
  ];

  // Subscribe to the action store to get updates when actions are registered/unregistered
  const unsubscribeActions = actionStore.subscribe(actions => {
    availableActions = actions;
    logService.debug(`Actions updated: ${actions.length} actions available`);
    
    // Reset selected index when actions change
    if (isActionDrawerOpen) {
      selectedActionIndex = 0;
    }
  });

  function handleActionPanelAction(event) {
    const actionId = event.detail.actionId;
    logService.debug(`Action panel button clicked: ${actionId}`);
    
    // Handle different actions
    switch (actionId) {
      case 'actions':
        toggleActionDrawer();
        break;
    }
  }
  
  function toggleActionDrawer() {
    isActionDrawerOpen = !isActionDrawerOpen;
    
    if (isActionDrawerOpen) {
      // Add class to body to indicate drawer is open
      document.body.classList.add('action-drawer-open');
      
      // When opening the drawer, set initial selection and move focus
      selectedActionIndex = 0;
      
      // Capture all keydowns globally while drawer is open by using a capturing event listener 
      document.addEventListener('keydown', captureAllKeydowns, true);
      
      // Move focus to the action drawer with a small delay to ensure the DOM is updated
      setTimeout(() => {
        // Get all action buttons in the drawer
        actionButtons = Array.from(actionDrawerRef?.querySelectorAll('button') || []);
        
        // Focus the first action button if available
        if (actionButtons.length > 0) {
          actionButtons[0].focus();
        } else {
          // If no actions, focus the drawer itself so keyboard events work
          actionDrawerRef?.focus();
        }
      }, 50);
    } else {
      // Remove the class and the global capturing event handler
      document.body.classList.remove('action-drawer-open');
      document.removeEventListener('keydown', captureAllKeydowns, true);
      
      // When closing, return focus to search input
      if (searchInput) {
        setTimeout(() => {
          searchInput.focus();
        }, 50);
      }
    }
  }
  
  // Capture all keyboard events when action drawer is open
  function captureAllKeydowns(event: KeyboardEvent) {
    // Only capture arrow keys, tab, enter, and escape to prevent them propagating to extensions
    if (isActionDrawerOpen && ['ArrowUp', 'ArrowDown', 'Tab', 'Enter', ' ', 'Escape'].includes(event.key)) {
      // Stop propagation to prevent extensions from receiving these events
      event.stopPropagation();
      
      // Let our drawer handler process this event normally
      handleActionKeydown(event);
    }
  }
  
  function handleActionKeydown(event: KeyboardEvent) {
    if (!isActionDrawerOpen || availableActions.length === 0) return;
    
    // For action drawer keydown, be more aggressive in capturing events
    switch (event.key) {
      case 'ArrowDown':
      case 'Tab':
        if (!event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          selectedActionIndex = (selectedActionIndex + 1) % availableActions.length;
          focusSelectedAction();
        }
        break;
        
      case 'ArrowUp':
      case 'Tab': // Handle Shift+Tab
        if (event.key === 'Tab' && !event.shiftKey) break;
        
        event.preventDefault();
        event.stopPropagation();
        selectedActionIndex = (selectedActionIndex - 1 + availableActions.length) % availableActions.length;
        focusSelectedAction();
        break;
        
      case 'Enter':
      case ' ': // Space key
        event.preventDefault();
        event.stopPropagation();
        if (selectedActionIndex >= 0 && selectedActionIndex < availableActions.length) {
          handleActionSelect(availableActions[selectedActionIndex].id);
        }
        break;
        
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        isActionDrawerOpen = false;
        document.body.classList.remove('action-drawer-open');
        document.removeEventListener('keydown', captureAllKeydowns, true);
        // Return focus to search input
        setTimeout(() => searchInput?.focus(), 50);
        break;
    }
  }
  
  function focusSelectedAction() {
    // Focus the currently selected action button
    setTimeout(() => {
      actionButtons = Array.from(actionDrawerRef?.querySelectorAll('button') || []);
      if (actionButtons[selectedActionIndex]) {
        actionButtons[selectedActionIndex].focus();
      }
    }, 10);
  }
  
  function handleActionSelect(actionId: string) {
    logService.debug(`Action selected: ${actionId}`);
    isActionDrawerOpen = false;
    document.body.classList.remove('action-drawer-open');
    document.removeEventListener('keydown', captureAllKeydowns, true);
    
    try {
      // Return focus to search input first, then execute action
      if (searchInput) {
        searchInput.focus();
      }
      
      // Execute the action using the action service
      actionService.executeAction(actionId);
    } catch (error) {
      logService.error(`Failed to execute action: ${error}`);
    }
  }
</script>

<!-- Replace the entire template section with this improved layout -->
<div class="flex flex-col h-screen overflow-hidden">
  <!-- Search header truly fixed at the top with higher z-index -->
  <div class="fixed top-0 left-0 right-0 z-[100] bg-[var(--bg-primary)] shadow-md">
    <SearchHeader
      bind:ref={searchInput}
      value={localSearchValue}
      showBack={!!$activeView}
      searchable={!($activeView && !$activeViewSearchable)}
      placeholder={$activeView 
        ? ($activeViewSearchable ? "Search..." : "Press Escape to go back") 
        : "Search or type a command..."}
      on:input={handleSearchInput}
      on:keydown={handleKeydown}
      on:click={handleBackClick}
    />
  </div>

  <!-- Add explicit spacing for the header height -->
  <div class="h-[72px] flex-shrink-0"></div>
  
  <!-- Content area with independent scrolling -->
  <div class="flex-1 overflow-hidden relative">
    <!-- Scrollable container with bottom padding for action panel -->
    <div class="absolute inset-0 overflow-y-auto pb-16">
      {#if $activeView && loadedComponent}
        <div class="min-h-full" data-extension-view={$activeView}>
          <svelte:component this={loadedComponent} />
        </div>
      {:else}
        <div class="min-h-full">
          <div class="w-full">
            <div bind:this={listContainer}>
              {#if extensionItems.length > 0}
                <ResultsList
                  items={extensionItems}
                  selectedIndex={$searchResults.selectedIndex}
                  on:select={({ detail }) => {
                    if (detail.item && detail.item.action) {
                      detail.item.action();
                    }
                  }}
                />
              {/if}

              <ResultsList
                items={applicationItems}
                selectedIndex={$searchResults.selectedIndex - extensionItems.length}
                on:select={({ detail }) => {
                  if (detail.item && detail.item.action) {
                    detail.item.action();
                  }
                }}
              />
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>

  <!-- Action drawer - no changes -->
  {#if isActionDrawerOpen}
    <div 
      class="fixed bottom-14 right-0 z-50 flex justify-end pr-4"
      bind:this={actionDrawerRef}
      tabindex="-1"
    >
      <div 
        class="bg-[var(--bg-primary)] w-full max-w-sm overflow-hidden transition-all transform shadow-lg border border-[var(--border-color)] rounded-lg mr-0 ml-4 mb-2"
        role="dialog"
        aria-modal="true"
        style="max-height: 66vh;"
      >
        <div class="flex flex-col h-full max-h-[66vh]">
          <div class="p-4 border-b border-[var(--border-color)] flex-shrink-0">
            <h2 class="text-xl font-semibold text-[var(--text-primary)] flex items-center justify-between">
              <span>Actions</span>
              <div class="flex items-center gap-2">
                <kbd class="bg-[var(--bg-secondary)] px-2 py-1 rounded text-sm text-[var(--text-secondary)]">⌘K</kbd>
                <button 
                  class="ml-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  on:click={() => isActionDrawerOpen = false}
                >
                  ✕
                </button>
              </div>
            </h2>
          </div>
          
          <!-- Scrollable content area -->
          <div class="overflow-y-auto overscroll-contain p-2 flex-1" style="max-height: calc(66vh - 70px);">
            <div class="space-y-1">
              {#each availableActions as action, index}
                <button 
                  class="w-full text-left p-3 rounded transition-colors flex items-center gap-3
                        {selectedActionIndex === index ? 'bg-[var(--bg-selected)] focus:outline-none ring-2 ring-[var(--accent-primary)]' : 'hover:bg-[var(--bg-hover)]'}"
                  on:click={() => handleActionSelect(action.id)}
                  data-index={index}
                  tabindex="0"
                >
                  <span class="text-xl flex-shrink-0">{action.icon}</span>
                  <div class="flex-1 min-w-0">
                    <div class="font-medium text-[var(--text-primary)] break-words">{action.label}</div>
                    {#if action.description}
                      <div class="text-sm text-[var(--text-secondary)] break-words">{action.description}</div>
                    {/if}
                  </div>
                </button>
              {/each}
              
              <!-- Add padding at the bottom for better scrolling experience -->
              <div class="h-2"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Action panel fixed at the bottom with higher z-index -->
  <div class="fixed bottom-0 left-0 right-0 z-30 bg-[var(--bg-primary)]">
    <ActionPanel 
      actions={actionPanelActions}
      on:action={handleActionPanelAction}
    />
  </div>
</div>

<style global>
  /* Style to visually distinguish when drawer is open */
  body.action-drawer-open .result-item {
    pointer-events: none; /* Prevent clicking items when drawer is open */
    opacity: 0.7; /* Visual indication that items are inactive */
  }
  
  /* Remove focus indicators from interactive elements when drawer is open */
  body.action-drawer-open .result-item:focus,
  body.action-drawer-open [tabindex="0"]:focus {
    outline: none !important;
    box-shadow: none !important;
  }

  /* Prevent body scrolling entirely so our app controls all scrolling */
  body {
    overflow: hidden;
    height: 100vh;
    margin: 0;
    padding: 0;
  }
  
  /* Add styles to ensure scrollbars look consistent */
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  
  ::-webkit-scrollbar-thumb {
    background-color: var(--scrollbar-thumb, rgba(155, 155, 155, 0.5));
    border-radius: 8px;
  }
</style>