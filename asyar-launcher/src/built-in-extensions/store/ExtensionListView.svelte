<!--
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Unsubscriber } from 'svelte/store';
  import type { IExtensionManager, ILogService } from 'asyar-api';
  // Import the initializer function and the type for the state
  import { initializeStore, type StoreViewState } from './state';
  // We'll use basic divs and flexbox instead of Card or ResultsList for custom layout

  // --- Local State Variables ---
  let isLoading = true; // Default to true before init
  let error: string | null = null;
  let filteredItems: any[] = []; // Default to empty array
  let selectedIndex = -1; // Default to -1
  let extensionManager: IExtensionManager | null = null; // Will be null initially
  let logService: ILogService | null = null; // Will be null initially

  let listContainer: HTMLDivElement; // For scrolling selected item into view
  let isActive = false; // Track if the view is active for keydown handling
  let unsubscribeStore: Unsubscriber | null = null;
  let storeInstance: ReturnType<typeof initializeStore> | null = null; // Hold the store instance

  onMount(async () => {
    // Initialize the store *first* and get the instance
    storeInstance = initializeStore();

    if (!storeInstance) {
      console.error("[ExtensionListView] Failed to initialize store!");
      error = "Internal error: Could not initialize view state.";
      isLoading = false;
      return;
    }

    // Subscribe manually
    unsubscribeStore = storeInstance.subscribe((state: StoreViewState) => {
      logService = state.logService; // Update logService first
      logService?.debug("[ListView] Store updated via manual subscription"); // Add log
      isLoading = state.isLoading;
      error = state.loadError ? state.errorMessage : null;
      filteredItems = state.filteredItems;
      selectedIndex = state.selectedIndex;
      extensionManager = state.extensionManager;

      // Ensure selected item is visible after state updates
      if (listContainer) { // Check if container is rendered
          ensureSelectedVisible(); // Call this within subscription
      }
    });

    // Now that the store is initialized and subscribed, logService should be available
    logService?.info('ExtensionListView mounted, subscribing to store, adding keydown listener.');

    isActive = true;
    window.addEventListener('keydown', handleKeydown); // Add window listener
    listContainer?.focus(); // Ensure container has focus

    // --- Initial Data Fetch ---
    logService?.debug('[ExtensionListView] onMount: Starting fetch...');
    storeInstance.setLoading(true); // Use store action
    try {
      // TODO: Replace with actual API call or service method
      const response = await fetch('http://asyar-website.test/api/extensions');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      const fetchedExtensions = data.data || [];
      logService?.debug(`[ExtensionListView] onMount: Fetch successful. Status: ${response.status}. Data length: ${fetchedExtensions.length}`);
      logService?.info(`Fetched ${fetchedExtensions.length} extensions.`);
      storeInstance.setItems(fetchedExtensions); // Use store action
      logService?.debug('[ExtensionListView] onMount: State update dispatched (setItems).');
    } catch (e: any) {
      logService?.error(`[ExtensionListView] onMount: Fetch failed! Error: ${e.message}`);
      logService?.error(`Failed to fetch extensions: ${e.message}`);
      storeInstance.setError(`Failed to load extensions: ${e.message}`); // Use store action
      logService?.debug('[ExtensionListView] onMount: State update dispatched (setError).');
    }
    // setLoading(false) is handled by setItems/setError actions internally
  });

  function viewExtensionDetail(slug: string) {
    logService?.debug(`[ListView] viewExtensionDetail called with slug: ${slug}`);
    if (!storeInstance) {
        logService?.error('[ListView] Store instance not available for setting slug.');
        return;
    }
    storeInstance.setSelectedExtensionSlug(slug); // Use store action
    logService?.debug(`[ListView] Set selected slug: ${slug}`);

    if (extensionManager) {
      logService?.debug(`[ListView] Navigating to detail view via ExtensionManager.`);
      extensionManager.navigateToView(`store/ExtensionDetailView`);
    } else {
      logService?.error('[ListView] ExtensionManager not available for navigation.');
      storeInstance.setError('Cannot navigate: ExtensionManager not found.'); // Use store action
    }
  }

  // --- Keyboard Navigation & Search Handling ---

  function handleKeydown(event: KeyboardEvent) {
    logService?.debug(`[ExtensionListView] handleKeydown fired. Key: ${event.key}, isActive: ${isActive}, filteredItems: ${filteredItems.length}`);
    if (!isActive || !filteredItems.length || !storeInstance) return; // Check store instance

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      storeInstance.moveSelection(event.key === "ArrowUp" ? 'up' : 'down'); // Use store action
      // ensureSelectedVisible is called within the subscription now
    } else if (event.key === "Enter" && selectedIndex !== -1) {
      logService?.debug(`[ListView] Enter key condition met. selectedIndex: ${selectedIndex}`);
      event.preventDefault();
      event.stopPropagation();
      const selectedItem = filteredItems[selectedIndex];
      if (selectedItem) {
        logService?.debug(`[ListView] Found selected item for Enter key: ${selectedItem.slug}`);
        viewExtensionDetail(selectedItem.slug); // Trigger action for selected item
      } else {
        logService?.debug(`[ListView] Enter key pressed but selectedItem is null/undefined.`);
      }
    }
  }

   function ensureSelectedVisible() {
     // Debounce or throttle this if it causes performance issues on rapid updates
     requestAnimationFrame(() => {
       const element = listContainer?.querySelector(`[data-index="${selectedIndex}"]`);
       if (element) {
         logService?.debug(`[ListView] Scrolling element ${selectedIndex} into view.`);
         element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
       }
     });
   }

   function selectItem(index: number) {
      if (!storeInstance) {
          logService?.error('[ListView] Store instance not available for selecting item.');
          return;
      }
      storeInstance.setSelectedItemByIndex(index); // Use store action
   }

 // New function to handle single-click logic
   function handleSingleClick(index: number) {
     logService?.debug(`[ListView] handleSingleClick called for index: ${index}`);
     selectItem(index);
   }

 // New function to handle double-click logic
   function handleDoubleClick(slug: string) {
     logService?.debug(`[ListView] handleDoubleClick called for slug: ${slug}`);
     viewExtensionDetail(slug);
   }

  onDestroy(() => {
    logService?.debug("[ListView] onDestroy: Cleaning up...");
    window.removeEventListener('keydown', handleKeydown); // Add cleanup for window listener
    isActive = false;
    if (unsubscribeStore) {
      logService?.debug("[ListView] Unsubscribing from store."); // Add log
      unsubscribeStore();
    }
    logService?.debug("[ListView] Cleanup complete.");
  });

</script>
-->
<script lang="ts">
  // Minimal script block for testing component loading
  console.log('[ListView] Minimal script running');
</script>

<!-- Template remains largely the same, relying on the reactive variables -->
<div class="p-4">
  <h2 class="text-xl font-semibold mb-4">Extension Store (Minimal Test)</h2>
  <p>If you see this, the component loaded without Svelte lifecycle/store errors.</p>
</div>

<!--
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
  /* Ensure selected-result style is defined if not globally available */
  .selected-result {
    background-color: var(--bg-selected, lightblue); /* Example selected style */
    border-color: var(--accent-color, blue);
  }
</style>
-->
