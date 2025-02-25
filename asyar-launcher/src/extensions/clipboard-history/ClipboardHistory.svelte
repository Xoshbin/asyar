<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { ClipboardHistoryService } from "../../services/ClipboardHistoryService";
  import type { ClipboardHistoryItem } from "../../types/clipboard";
  import { format } from "date-fns";
  import { clipboardViewState } from "./state";

  const clipboardService = new ClipboardHistoryService();
  let items: ClipboardHistoryItem[] = [];
  let allItems: ClipboardHistoryItem[] = [];
  let retentionDays = 90;
  let selectedItem: ClipboardHistoryItem | null = null;
  let selectedIndex = 0;
  let listContainer: HTMLDivElement;

  $: items = $clipboardViewState.searchQuery
    ? allItems.filter(item => {
        const content = item.content.toLowerCase();
        const query = $clipboardViewState.searchQuery.toLowerCase();
        return content.includes(query);
      })
    : allItems;

  // Update selection when items change
  $: {
    if (items.length > 0) {
      if (selectedIndex >= items.length) {
        selectedIndex = 0;
      }
      selectedItem = items[selectedIndex];
    } else {
      selectedItem = null;
      selectedIndex = -1;
    }
  }

  onMount(async () => {
    await clipboardService.initialize();
    allItems = await clipboardService.getHistory();
    items = allItems;
    retentionDays = await clipboardService.getRetentionPeriod();
    
    // Add keyboard event listener
    window.addEventListener('keydown', handleKeydown);

    // Select first item if available
    if (items.length > 0) {
      selectedItem = items[0];
      selectedIndex = 0;
    }

    // Focus the list container initially
    if (listContainer) {
      listContainer.focus();
    }
  });

  onDestroy(async () => {
    await clipboardService.destroy();
    window.removeEventListener('keydown', handleKeydown);
  });

  async function handleRetentionChange() {
    await clipboardService.setRetentionPeriod(retentionDays);
    items = await clipboardService.getHistory();
  }

  async function restoreItem(item: ClipboardHistoryItem) {
    await clipboardService.restoreItem(item);
  }

  async function clearHistory() {
    if (confirm("Are you sure you want to clear all history?")) {
      await clipboardService.clearHistory();
      items = [];
    }
  }

  function getItemPreview(item: ClipboardHistoryItem, full = false) {
    const preview = full ? item.content : item.content.substring(0, 100);
    
    switch (item.type) {
      case "image":
        return `<img src="data:image/png;base64,${item.content}" class="${full ? 'max-w-full' : 'w-16 h-16'} object-cover rounded" />`;
      case "text":
        return full ? `<pre class="whitespace-pre-wrap">${preview}</pre>` : preview;
      case "html":
        return full ? item.content : `<div class="text-xs italic">[HTML Content]</div>`;
      default:
        return `[${item.type} content]`;
    }
  }

  function selectItem(item: ClipboardHistoryItem, index: number) {
    selectedItem = item;
    selectedIndex = index;
    
    // Keep search input focused
    const searchInput = document.querySelector('input[type="text"]') as HTMLInputElement;
    if (searchInput) {
      searchInput.focus();
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!items.length) return;

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      // Prevent default scroll behavior
      event.preventDefault();
      event.stopPropagation();

      const newIndex = event.key === 'ArrowUp'
        ? Math.max(0, selectedIndex - 1)
        : Math.min(items.length - 1, selectedIndex + 1);

      if (newIndex !== selectedIndex) {
        selectedIndex = newIndex;
        selectedItem = items[selectedIndex];
        // Always scroll when selection changes
        requestAnimationFrame(() => scrollToSelected(true));
      }
    } else if (event.key === 'Enter' && selectedItem) {
      event.preventDefault();
      event.stopPropagation();
      restoreItem(selectedItem);
    }
  }

  function scrollToSelected(forceScroll = false) {
    const element = listContainer?.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement;
    if (!element) return;

    const container = listContainer;
    const elementRect = element.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const isElementAbove = elementRect.top < containerRect.top;
    const isElementBelow = elementRect.bottom > containerRect.bottom;
    const needsScroll = forceScroll || isElementAbove || isElementBelow;

    if (needsScroll) {
      element.scrollIntoView({
        block: forceScroll ? 'center' : (isElementAbove ? 'start' : 'end'),
        behavior: 'smooth'
      });
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="h-[calc(100vh-72px)] bg-gray-100 dark:bg-gray-900 flex flex-col overflow-hidden">
  <!-- Main Content -->
  <div class="flex-1 flex">
    <!-- Left Side: List (1/3 width) -->
    <div 
      bind:this={listContainer}
      class="w-1/3 overflow-y-auto border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 focus:outline-none"
      tabindex="0"
    >
        {#if items.length === 0}
          <div class="text-center py-12 text-gray-500 dark:text-gray-400">
            No clipboard history yet
          </div>
        {:else}
          <div class="divide-y divide-gray-200 dark:divide-gray-700">
            {#each items as item, index (item.id)}
              <div
                data-index={index}
                class="p-3 hover:bg-gray-50 dark:hover:bg-gray-750 cursor-pointer transition 
                       {selectedIndex === index ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500' : 'border-l-4 border-transparent'}"
                on:click={() => selectItem(item, index)}
              >
                <div class="flex items-center gap-2 mb-1.5">
                  <span class="text-xs font-medium px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-100 rounded-full">
                    {item.type}
                  </span>
                  <span class="text-xs text-gray-500 dark:text-gray-400">
                    {format(item.timestamp, "HH:mm")}
                  </span>
                </div>
                <div class="dark:text-white text-sm line-clamp-2">
                  {@html getItemPreview(item)}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Right Side: Details (2/3 width) -->
      <div class="w-2/3 overflow-y-auto bg-white dark:bg-gray-800/30">
        {#if selectedItem}
          <div class="h-full">
            <div class="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4 shadow-sm z-10">
              <div class="flex justify-between items-center">
                <div class="flex items-center gap-3">
                  <span class="text-sm font-medium px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-100 rounded-full">
                    {selectedItem.type}
                  </span>
                  <span class="text-sm text-gray-500 dark:text-gray-400">
                    {format(selectedItem.timestamp, "PPpp")}
                  </span>
                </div>
              </div>
            </div>
            <div class="p-6">
              <div class="dark:text-white overflow-auto max-h-[calc(100vh-200px)] prose dark:prose-invert max-w-none">
                {@html getItemPreview(selectedItem, true)}
              </div>
            </div>
          </div>
        {:else}
          <div class="flex h-full items-center justify-center text-gray-500 dark:text-gray-400 flex-col gap-4">
            <svg class="w-16 h-16 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <span class="text-lg font-medium">Select an item to view details</span>
          </div>
        {/if}
      </div>
  </div>
</div>

<style>
  /* Customize scrollbar */
  .overflow-y-auto {
    scrollbar-width: thin;
    scrollbar-color: rgba(156, 163, 175, 0.5) transparent;
  }

  .overflow-y-auto::-webkit-scrollbar {
    width: 6px;
  }

  .overflow-y-auto::-webkit-scrollbar-track {
    background: transparent;
  }

  .overflow-y-auto::-webkit-scrollbar-thumb {
    background-color: rgba(156, 163, 175, 0.5);
    border-radius: 3px;
  }

  .overflow-y-auto::-webkit-scrollbar-thumb:hover {
    background-color: rgba(156, 163, 175, 0.7);
  }

  /* Add focus styles that don't show outline */
  .focus\:outline-none:focus {
    outline: none;
    box-shadow: inset 0 0 0 2px rgba(59, 130, 246, 0.1);
  }
</style>
