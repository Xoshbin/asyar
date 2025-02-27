<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { activeView, activeViewSearchable } from '../services/extensionManager';
  import { searchQuery, searchResults } from '../stores/search';
  import ApplicationsService from '../services/applicationsService';
  import extensionManager from '../services/extensionManager';
  import { LogService } from '../services/logService';
  import { invoke } from '@tauri-apps/api/core';
  import SearchHeader from '../components/layout/SearchHeader.svelte';

  let searchInput: HTMLInputElement;
  let localSearchValue = '';
  
  // Sync local value with store
  $: localSearchValue = $searchQuery;
  
  // Force focus after navigation with delay and keep focus when typing
  $: {
    if (searchInput) {
      // Always try to refocus the search input with a small delay to ensure DOM is updated
      setTimeout(() => {
        if (searchInput && (!document.activeElement || document.activeElement !== searchInput)) {
          LogService.debug("Refocusing search input");
          searchInput.focus();
          searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
        }
      }, 10);
    }
  }

  // Global keydown handler for Escape key in non-searchable views
  function handleGlobalKeydown(event: KeyboardEvent) {
    // Don't interfere with extensions' own keyboard handlers for arrow keys
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && $activeView) {
      // Let extensions handle their own arrow navigation
      return;
    }
    
    // Re-focus search input if it loses focus
    if (searchInput && document.activeElement !== searchInput) {
      searchInput.focus();
    }
  }

  // Set up global keydown listener for non-searchable views
  let globalKeydownListenerActive = false;
  
  $: {
    // Always add global keydown listener when a view is active
    if ($activeView && !globalKeydownListenerActive) {
      window.addEventListener('keydown', handleGlobalKeydown, true);
      globalKeydownListenerActive = true;
      LogService.debug("Added global keydown listener");
    } 
    // Remove listener when not needed
    else if (!$activeView && globalKeydownListenerActive) {
      window.removeEventListener('keydown', handleGlobalKeydown, true);
      globalKeydownListenerActive = false;
      LogService.debug("Removed global keydown listener");
    }
  }

  // Handle search input changes
  function handleSearchInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    localSearchValue = value;
    searchQuery.set(value);
    
    // Only update search in extension view
    if ($activeView && $activeViewSearchable) {
      LogService.debug(`Search in extension: "${value}"`);
      extensionManager.handleViewSearch(value);
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    // Handle Escape key
    if (event.key === 'Escape') {
      event.preventDefault();
      if ($activeView) {
        // If in extension view, return to main screen
        LogService.debug("Escape pressed, returning to main screen");
        extensionManager.closeView();
      } else {
        // If in main view, hide the app
        LogService.debug("Escape pressed in main view, hiding app");
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
      LogService.debug("Backspace/Delete on empty input, returning to main screen");
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
      ApplicationsService.open(selectedApp);
    }
  }
  
  function handleBackClick() {
    if ($activeView) {
      LogService.debug("Back button clicked, returning to main screen");
      extensionManager.closeView();
    }
  }

  onMount(() => {
    // Focus input on mount
    if (searchInput) {
      searchInput.focus();
    }
    
    // Add a click handler to maintain search input focus
    document.addEventListener('click', maintainSearchFocus);
  });

  onDestroy(() => {
    // Clean up global event listeners
    if (globalKeydownListenerActive) {
      window.removeEventListener('keydown', handleGlobalKeydown, true);
    }
    document.removeEventListener('click', maintainSearchFocus);
  });
  
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
    
    if (searchInput && document.activeElement !== searchInput && $activeView) {
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
</script>

<div class="min-h-screen flex flex-col">
  <!-- Increase z-index and add shadow + proper background to ensure header stays on top -->
  <div class="fixed inset-x-0 top-0 z-[100] bg-[var(--bg-primary)] shadow-md">
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

  <!-- Add proper spacing and isolation to prevent overlap -->
  <div class="pt-[72px] flex-1 overflow-hidden relative isolate">
    <!-- Container with its own scrolling context -->
    <div class="h-full w-full overflow-auto">
      <slot />
    </div>
  </div>
</div>

<style>
  /* Add styles to ensure proper positioning */
  :global(.app-layout) {
    position: relative;
    z-index: 1; /* Lower than header */
    height: 100%;
    overflow: hidden;
  }
  
  :global(.custom-scrollbar) {
    /* Ensure scrollbars have proper z-index */
    position: relative;
    z-index: 1;
  }
</style>
