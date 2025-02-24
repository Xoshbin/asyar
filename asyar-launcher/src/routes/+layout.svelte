<script lang="ts">
  import { activeView } from '../services/extensionManager';
  import { searchQuery, searchResults } from '../stores/search';
  import ApplicationsService from '../services/applicationsService';

  function handleKeydown(event: KeyboardEvent) {
    // Allow extensions to handle their own keyboard events if a view is active
    if ($activeView) return;

    const totalItems = $searchResults.extensions.length + $searchResults.applications.length;
    
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      
      const newIndex = event.key === 'ArrowDown'
        ? ($searchResults.selectedIndex + 1) % totalItems
        : $searchResults.selectedIndex - 1 < 0 
          ? totalItems - 1 
          : $searchResults.selectedIndex - 1;

      searchResults.update(state => ({ ...state, selectedIndex: newIndex }));
    } 
    else if (event.key === 'Enter' && totalItems > 0) {
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
  }
</script>

<div class="min-h-screen flex flex-col">
  <!-- Persistent Search Bar -->
  <div class="fixed inset-x-0 top-0 z-50">
    <div class="w-full relative border-b-[0.5px] border-gray-400/20">
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        autoComplete="off"
        spellCheck={false}
        autofocus
        placeholder="Search or type a command..."
        class="w-full text-white text-lg outline-none placeholder-gray-400 px-8 py-5"
        bind:value={$searchQuery}
        on:keydown={handleKeydown}
      />
      <div class="absolute right-6 top-1/2 -translate-y-1/2">
        <kbd class="px-2.5 py-1.5 text-xs text-gray-400 rounded">⌘K</kbd>
      </div>
    </div>
  </div>

  <!-- Content Area -->
  <div class="pt-[72px] flex-1">
    <slot />
  </div>
</div>
