<script lang="ts">
  import { onMount, onDestroy, getContext } from 'svelte'; // Add onDestroy
  import type { IExtensionManager, ILogService } from 'asyar-api';
  import { storeViewState } from './state'; // Import the main state store
  // We'll use basic divs and flexbox instead of Card or ResultsList for custom layout

  // Define the structure based on the API response
  interface ExtensionAuthor {
    id: number;
    name: string;
  }

  interface ApiExtension {
    id: number;
    name: string;
    slug: string;
    description: string;
    category: string;
    status: string;
    repository_url: string;
    install_count: number;
    icon_url: string;
    screenshot_urls: string[];
    created_at: string;
    updated_at: string;
    last_polled_at: string | null;
    author: ExtensionAuthor;
  }

  // Subscribe to the state store
  $: isLoading = $storeViewState.isLoading;
  $: error = $storeViewState.loadError ? $storeViewState.errorMessage : null;
  $: filteredItems = $storeViewState.filteredItems; // Use filtered items from state
  $: selectedIndex = $storeViewState.selectedIndex;
  $: extensionManager = $storeViewState.extensionManager; // Get manager from the store state

  // Get log service from context (assuming this still works or is less critical for navigation)
  const logService = getContext<ILogService>('LogService'); 

  let listContainer: HTMLDivElement; // For scrolling selected item into view
  let isActive = false; // Track if the view is active for keydown handling

  onMount(async () => {
    isActive = true;
    window.addEventListener('keydown', handleKeydown); // Add window listener
    listContainer?.focus(); // Ensure container has focus
    logService?.info('ExtensionListView mounted, fetching extensions, adding keydown listener, and focusing container.');
    storeViewState.setLoading(true); // Use state action
    error = null; // Reset local error display if needed
    try {
      const response = await fetch('http://asyar-website.test/api/extensions');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      const fetchedExtensions = data.data || [];
      logService?.info(`Fetched ${fetchedExtensions.length} extensions.`);
      storeViewState.setItems(fetchedExtensions); // Set items in the store
    } catch (e: any) {
      logService?.error(`Failed to fetch extensions: ${e.message}`);
      storeViewState.setError(`Failed to load extensions: ${e.message}`); // Set error in the store
    } finally {
      // setLoading(false) is handled by setItems/setError
    }
  });

  function viewExtensionDetail(slug: string) {
    console.log(`[ListView] viewExtensionDetail called with slug: ${slug}`); // Use console.log
    console.log(`[ListView] Setting selected slug and navigating to detail view: ${slug}`); // Use console.log
    storeViewState.setSelectedExtensionSlug(slug); // Use state action
    if (extensionManager) {
      extensionManager.navigateToView(`store/ExtensionDetailView`);
    } else {
      console.error('[ListView] ExtensionManager not available for navigation.'); // Use console.error
      error = 'Cannot navigate: ExtensionManager not found.';
    }
  }

  // --- Keyboard Navigation & Search Handling ---

  function handleKeydown(event: KeyboardEvent) {
    logService?.debug(`[ExtensionListView] handleKeydown fired. Key: ${event.key}, isActive: ${isActive}, filteredItems: ${filteredItems.length}`);
    if (!isActive || !filteredItems.length) return;

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      storeViewState.moveSelection(event.key === "ArrowUp" ? 'up' : 'down');
      ensureSelectedVisible();
    } else if (event.key === "Enter" && selectedIndex !== -1) {
      console.log(`[ListView] Enter key condition met. selectedIndex: ${selectedIndex}`); // <-- Add console.log
      event.preventDefault();
      event.stopPropagation();
      const selectedItem = filteredItems[selectedIndex];
      if (selectedItem) {
        console.log(`[ListView] Found selected item for Enter key: ${selectedItem.slug}`); // <-- Add console.log
        viewExtensionDetail(selectedItem.slug); // Trigger action for selected item
      } else {
        console.log(`[ListView] Enter key pressed but selectedItem is null/undefined.`); // <-- Add console.log
      }
    }
  }

 function ensureSelectedVisible() {
    requestAnimationFrame(() => {
      const element = listContainer?.querySelector(`[data-index="${selectedIndex}"]`);
      if (element) {
        element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  function selectItem(index: number) {
     storeViewState.setSelectedItemByIndex(index);
  }

  // New function to handle single-click logic
  function handleSingleClick(index: number) {
    console.log(`[ListView] handleSingleClick called for index: ${index}`); // Use console.log
    selectItem(index);
  }

  // New function to handle double-click logic
  function handleDoubleClick(slug: string) {
    console.log(`[ListView] handleDoubleClick called for slug: ${slug}`); // Use console.log
    viewExtensionDetail(slug);
  }

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown); // Add cleanup for window listener
    isActive = false;
  });

</script>

<div class="extension-list-view p-4" bind:this={listContainer} tabindex="-1"> <!-- Removed on:keydown -->
  <h2 class="text-xl font-semibold mb-4 sticky top-0 bg-[var(--bg-primary)] z-10 pb-2">Extension Store</h2>

  {#if isLoading}
    <p class="text-center">Loading extensions...</p>
  {:else if error}
    <p class="text-red-500 text-center">{error}</p>
  {:else if filteredItems.length === 0}
    <p class="text-center">No extensions found.</p>
  {:else}
    <div class="flex flex-col gap-2">
      {#each filteredItems as ext, index (ext.id)}
        <button
          type="button"
          data-index={index}
          class="extension-item text-left p-3 rounded-md hover:bg-[var(--bg-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-color)] transition-colors duration-150 flex items-center gap-4"
          class:selected-result={index === selectedIndex}
          on:click={() => { console.log(`[ListView] Inline click on index: ${index}`); handleSingleClick(index); }}
          on:dblclick={() => { console.log(`[ListView] Inline dblclick on slug: ${ext.slug}`); handleDoubleClick(ext.slug); }}
        >
          <!-- Main Content: Icon, Name, Description, Author -->
          <div class="flex items-center gap-3 flex-grow min-w-0">
            {#if ext.icon_url}
              <img src={ext.icon_url} alt="{ext.name} icon" class="w-10 h-10 object-contain rounded flex-shrink-0">
            {:else}
              <div class="w-10 h-10 bg-gray-200 rounded flex items-center justify-center text-gray-500 flex-shrink-0">
                Ext
              </div>
            {/if}
            <div class="flex-grow min-w-0">
              <h3 class="font-medium truncate">{ext.name}</h3>
              <p class="text-sm text-[var(--text-secondary)] truncate">{ext.description}</p>
              <p class="text-xs text-[var(--text-tertiary)] truncate">By {ext.author.name}</p>
            </div>
          </div>

          <!-- Right Side: Install Count & Category -->
          <div class="flex flex-col items-center justify-center text-xs text-center w-16 flex-shrink-0 ml-4">
             <span class="font-semibold text-lg">{ext.install_count}</span>
             <span class="text-[var(--text-secondary)]">Installs</span>
             <span class="mt-1 text-[var(--text-secondary)] capitalize border border-[var(--border-color)] px-1 rounded text-[10px]">{ext.category}</span>
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .extension-list-view {
     height: 100%;
     display: flex;
     flex-direction: column;
     overflow-y: auto; /* Add scrollbar to the main container */
  }
  .extension-item {
    border: 1px solid var(--border-color);
  }
  .extension-item:hover {
     border-color: var(--border-color-hover);
  }
</style>
