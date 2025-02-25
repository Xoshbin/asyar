<script lang="ts">
  import { onMount } from 'svelte';
  import { activeView, activeViewSearchable } from '../services/extensionManager';
  import { searchQuery, searchResults } from '../stores/search';
  import ApplicationsService from '../services/applicationsService';
  import extensionManager from '../services/extensionManager';
  import { LogService } from '../services/logService';

  let searchInput: HTMLInputElement;
  let localSearchValue = '';
  
  // Skip binding and use local value with events
  $: localSearchValue = $searchQuery;
  
  function handleSearchInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    localSearchValue = value;
    searchQuery.set(value);
    
    if ($activeView && $activeViewSearchable) {
      LogService.debug(`Search in extension: "${value}"`);
      extensionManager.handleViewSearch(value);
    }
  }
  
  // Force focus after navigation with delay
  $: if ($activeView !== null) {
    setTimeout(() => {
      if (searchInput && $activeViewSearchable) {
        LogService.debug("Forcing focus on search input");
        searchInput.focus();
        // Try to set cursor position too
        searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
      }
    }, 200); // Slightly longer delay
  }

  function handleKeydown(event: KeyboardEvent) {
    // Only for main view navigation
    if (!$activeView) {
      // Main view keyboard navigation
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        
        const totalItems = $searchResults.extensions.length + $searchResults.applications.length;
        const newIndex = event.key === 'ArrowDown'
          ? ($searchResults.selectedIndex + 1) % totalItems
          : $searchResults.selectedIndex - 1 < 0 
            ? totalItems - 1 
            : $searchResults.selectedIndex - 1;

        searchResults.update(state => ({ ...state, selectedIndex: newIndex }));
      } 
      else if (event.key === 'Enter') {
        handleEnterKey();
      }
    } else if ($activeViewSearchable) {
      // Let extensions handle keyboard but keep input focused
      if (document.activeElement !== searchInput) {
        searchInput?.focus();
      }
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
  
  onMount(() => {
    // Focus input on mount
    if (searchInput) {
      searchInput.focus();
    }
  });
</script>

<div class="min-h-screen flex flex-col">
  <div class="fixed inset-x-0 top-0 z-50 bg-gray-900">
    <div class="w-full relative border-b-[0.5px] border-gray-400/20">
      <input
        bind:this={searchInput}
        type="text"
        autocomplete="off"
        spellcheck="false"
        value={localSearchValue}
        on:input={handleSearchInput}
        on:keydown={handleKeydown}
        placeholder={$activeView 
          ? $activeViewSearchable 
            ? "Search in current view..." 
            : "Search disabled for this view"
          : "Search or type a command..."}
        class="w-full text-white text-lg outline-none placeholder-gray-400 px-8 py-5 bg-transparent"
        class:opacity-50={$activeView && !$activeViewSearchable}
        disabled={$activeView && !$activeViewSearchable}
      />
      <div class="absolute right-6 top-1/2 -translate-y-1/2">
        <kbd class="px-2.5 py-1.5 text-xs text-gray-400 rounded">⌘K</kbd>
      </div>
    </div>
  </div>

  <div class="pt-[72px] flex-1 overflow-hidden">
    <slot />
  </div>
</div>
