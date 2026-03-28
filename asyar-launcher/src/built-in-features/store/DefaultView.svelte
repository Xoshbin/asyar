<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { storeViewState as store } from './state.svelte';
  import SplitView from '../../components/list/SplitView.svelte';

  let isLoading = $derived(store.isLoading);
  let error = $derived(store.loadError ? store.errorMessage : null);
  let filteredItems = $derived(store.filteredItems);
  let selectedIndex = $derived(store.selectedIndex);
  let selectedItem = $derived(store.selectedItem);
  let extensionManager = $derived(store.extensionManager);

  let listContainer: HTMLDivElement | undefined = $state();

  onMount(async () => {
    await tick();
  });

  function ensureSelectedVisible() {
    requestAnimationFrame(() => {
      if (!listContainer) return;
      const element = listContainer.querySelector(`[data-index="${selectedIndex}"]`);
      if (element) {
        const containerRect = listContainer.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const isAbove = elementRect.top < containerRect.top;
        const isBelow = elementRect.bottom > containerRect.bottom;

        if (isAbove) {
          element.scrollIntoView({ block: 'start', behavior: 'auto' });
        } else if (isBelow) {
          element.scrollIntoView({ block: 'end', behavior: 'auto' });
        }
      }
    });
  }

  function selectItem(index: number) {
    store.setSelectedItemByIndex(index);
  }

  $effect(() => {
    if (selectedIndex !== undefined && !isLoading && !error) {
      ensureSelectedVisible();
    }
  });

  function handleDoubleClick(slug: string) {
    store.setSelectedExtensionSlug(slug);
    if (extensionManager) {
      extensionManager.navigateToView(`store/DetailView`);
    }
  }
</script>

<SplitView leftWidth={320} minLeftWidth={250} maxLeftWidth={500}>
  {#snippet left()}
    <div 
      bind:this={listContainer}
      class="h-full overflow-y-auto focus:outline-none bg-white dark:bg-[#1e1e1e] py-2 border-r border-gray-100 dark:border-gray-800 custom-scrollbar"
      role="listbox"
      aria-label="Store Extensions"
      tabindex="0"
    >
      {#if isLoading}
        <div class="flex items-center justify-center p-8">
          <div class="text-gray-500 dark:text-gray-400 text-sm">Loading extensions...</div>
        </div>
      {:else if error}
        <div class="p-4 text-red-500 bg-red-100/10 rounded-lg m-4 border border-red-500/20 text-center text-sm">
          {error}
        </div>
      {:else if filteredItems.length === 0}
        <div class="p-4 text-center text-sm text-gray-500">No extensions found</div>
      {:else}
        {#each filteredItems as item, index (item.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_interactive_supports_focus -->
          <div
            data-index={index}
            class="group flex items-center px-3 py-2.5 mx-2 my-0.5 rounded-lg cursor-default transition-colors {selectedIndex === index ? 'bg-blue-500 text-white shadow-sm' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200'}"
            role="option"
            aria-selected={selectedIndex === index}
            onclick={() => selectItem(index)}
            ondblclick={() => handleDoubleClick(item.slug)}
          >
            <div class="mr-3 flex-shrink-0 w-8 h-8 rounded-md overflow-hidden bg-gray-100 dark:bg-gray-800 flex items-center justify-center border border-gray-200 dark:border-gray-700">
              {#if item.icon_url}
                <img src={item.icon_url} alt={item.name} class="w-full h-full object-cover" />
              {:else}
                <span class="text-lg">🧩</span>
              {/if}
            </div>
            <div class="flex-1 overflow-hidden flex flex-col justify-center gap-0.5">
              <div class="flex items-center gap-2">
                <div class="truncate text-[13px] font-medium leading-none {selectedIndex === index ? 'text-white' : 'text-gray-900 dark:text-gray-100'}">
                  {item.name}
                </div>
              </div>
              <div class="truncate text-[11px] leading-none {selectedIndex === index ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'}">
                By {item.author.name}
              </div>
            </div>
            <div class="ml-2 flex-shrink-0 text-right space-y-1">
              <div class="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded {selectedIndex === index ? 'bg-white/20 text-white' : 'bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400'}">
                {item.category}
              </div>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  {/snippet}

  {#snippet right()}
    <div class="h-full flex flex-col bg-gray-50/50 dark:bg-[#161616]/50 overflow-hidden relative">
      {#if selectedItem}
        <div class="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar flex flex-col items-center pt-12">
          <div class="w-32 h-32 rounded-3xl bg-white dark:bg-gray-800 shadow-sm border border-gray-200 dark:border-gray-700 flex items-center justify-center mb-6 overflow-hidden">
            {#if selectedItem.icon_url}
              <img src={selectedItem.icon_url} alt={selectedItem.name} class="w-full h-full object-cover" />
            {:else}
              <span class="text-6xl">🧩</span>
            {/if}
          </div>
          
          <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-2 text-center">{selectedItem.name}</h2>
          
          <div class="flex items-center gap-3 text-[13px] text-gray-500 dark:text-gray-400 mb-6 font-medium">
            <span class="flex items-center gap-1">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
              {selectedItem.author.name}
            </span>
            <span class="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600"></span>
            <span class="flex items-center gap-1">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
              {selectedItem.install_count} Installs
            </span>
          </div>

          <p class="text-[14px] leading-relaxed text-gray-700 dark:text-gray-300 text-center max-w-md">
            {selectedItem.description}
          </p>

          {#if selectedItem.screenshot_urls && selectedItem.screenshot_urls.length > 0}
            <div class="mt-8 w-full max-w-md bg-white dark:bg-gray-800 p-2 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
              <img src={selectedItem.screenshot_urls[0]} alt="Screenshot" class="w-full rounded border border-gray-100 dark:border-gray-800 object-cover" />
            </div>
          {/if}
        </div>

        <!-- Action Footer -->
        <div class="h-12 border-t border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-[#1e1e1e]/80 backdrop-blur-md flex items-center px-4 justify-between text-xs text-gray-500 dark:text-gray-400 shadow-sm z-10 w-full shrink-0">
          <div class="flex items-center gap-3">
                <span class="uppercase tracking-wider text-[10px] font-bold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded border border-green-200 dark:border-green-800">
                  {selectedItem.status}
                </span>
              <span>Added {new Date(selectedItem.created_at).toLocaleDateString()}</span>
          </div>
          <div class="flex items-center gap-1.5 opacity-80 font-medium">
            <kbd class="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-sans shadow-sm">Enter</kbd> 
            <span>to View Details</span>
          </div>
        </div>
      {:else}
        <div class="flex h-full items-center justify-center flex-col gap-4 text-gray-400 dark:text-gray-600">
          <svg class="w-16 h-16 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <span class="text-sm font-medium">Select an extension to view details</span>
        </div>
      {/if}
    </div>
  {/snippet}
</SplitView>

<style>
  .custom-scrollbar::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: rgba(150, 150, 150, 0.3);
    border-radius: 10px;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: rgba(150, 150, 150, 0.5);
  }
  
  kbd {
    font-size: 0.85em;
  }
</style>
