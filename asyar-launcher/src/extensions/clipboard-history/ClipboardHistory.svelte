<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { ClipboardHistoryItem } from "../../types/clipboardHistoryItem";
  import { format } from "date-fns";
  import { clipboardViewState } from "./state";
  import { SplitView } from "../../components";
  import { ExtensionApi } from "../../api/extensionApi";

  let items: ClipboardHistoryItem[] = [];
  let allItems: ClipboardHistoryItem[] = [];
  let retentionDays = 90;
  let selectedItem: ClipboardHistoryItem | null = null;
  let selectedIndex = 0;
  let listContainer: HTMLDivElement;
  let isActive = false; // Track if this component is currently mounted/active
  let isLoading = true;

  // Use fuzzy search when filtering
  $: items = $clipboardViewState.searchQuery
    ? clipboardViewState.search(allItems, $clipboardViewState.searchQuery)
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
    // Mark component as active
    isActive = true;
    
    // Load existing history using the ClipboardApi
    try {
      allItems = await ExtensionApi.clipboard.getHistory(100);
      
      // Initialize Fuse instance with all items
      clipboardViewState.initFuse(allItems);
      items = allItems;
    } catch (error) {
      console.error("Failed to load clipboard history:", error);
      allItems = [];
      items = [];
    } finally {
      isLoading = false;
    }
    
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

  onDestroy(() => {
    // Remove UI-specific event listeners
    window.removeEventListener('keydown', handleKeydown);
    
    // Mark component as inactive
    isActive = false;
  });

  async function simulatePaste(item: ClipboardHistoryItem) {
    if (!item || !item.id) return;

    try {
      await ExtensionApi.clipboard.pasteHistoryItem(item.id);
    } catch (error) {
      console.error("Failed to paste clipboard item:", error);
    }
  }

  async function clearHistory() {
    if (confirm("Are you sure you want to clear all non-favorite items?")) {
      await ExtensionApi.clipboard.clearHistory();
      // Refresh the list
      allItems = await ExtensionApi.clipboard.getHistory(100);
      clipboardViewState.initFuse(allItems);
      items = allItems;
    }
  }

  async function toggleFavorite(item: ClipboardHistoryItem, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    
    if (!item || !item.id) return;

    await ExtensionApi.clipboard.toggleFavorite(item.id);
    // Update the item in the local list
    item.favorite = !item.favorite;
    
    // Force UI update
    allItems = [...allItems];
  }

  // Display match score for search results or timestamp
  function getItemSubtitle(item: ClipboardHistoryItem) {
    if ($clipboardViewState.searchQuery && 'score' in item) {
      // Fix the type by casting score to number and providing a default value
      const score = typeof item.score === 'number' ? item.score : 0;
      return `Match: ${Math.round((1 - score) * 100)}% · ${format(item.createdAt, "HH:mm")}`;
    }
    return format(item.createdAt, "HH:mm");
  }

  function getItemPreview(item: ClipboardHistoryItem, full = false) {
    if (!item || !item.content) {
      return '<span class="text-gray-400">No preview available</span>';
    }
    
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
    // Only process key events if component is active
    if (!isActive || !items.length) return;

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      // Prevent default scroll behavior
      event.preventDefault();
      event.stopPropagation();

      // Calculate new index
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
      simulatePaste(selectedItem);
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

<SplitView leftWidth={300} minLeftWidth={200} maxLeftWidth={600}>
  <div slot="left" 
    bind:this={listContainer}
    class="h-full"
    tabindex="0"
    on:keydown|stopPropagation={handleKeydown}
  >
    {#if isLoading}
      <div class="flex justify-center items-center h-32">
        <div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[var(--text-color)]"></div>
      </div>
    {:else if items.length === 0}
      <div class="text-center py-12">
        <div class="result-subtitle">No clipboard history yet</div>
      </div>
    {:else}
      <div class="p-2">
        <button 
          on:click={clearHistory}
          class="w-full p-2 mb-2 text-sm text-center rounded bg-[var(--bg-selected)] hover:bg-[var(--border-color)]"
        >
          Clear History
        </button>
      </div>
      <div class="divide-y divide-[var(--border-color)]">
        {#each items as item, index (item.id)}
          <div
            data-index={index}
            class="result-item relative"
            class:selected-result={selectedIndex === index}
            on:click={() => selectItem(item, index)}
            on:dblclick={() => simulatePaste(item)}
          >
            <div class="flex items-center gap-2 mb-1.5">
              <span class="text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--bg-selected)]">
                <span class="result-title">{item.type}</span>
              </span>
              <span class="result-subtitle text-xs">
                {getItemSubtitle(item)}
              </span>
            </div>
            <div class="result-title text-sm line-clamp-2">
              {@html getItemPreview(item)}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <div slot="right" class="h-full flex flex-col overflow-hidden">
    {#if selectedItem}
      <!-- Sticky header -->
      <div class="bg-[var(--bg-selected)] border-b border-[var(--border-color)] p-4 shadow-sm">
        <div class="flex justify-between items-center">
          <div class="flex items-center gap-3">
            <span class="text-sm font-medium px-3 py-1 rounded-full bg-[var(--bg-primary)]">
              <span class="result-title">{selectedItem.type}</span>
            </span>
            <span class="result-subtitle text-sm">
              {format(selectedItem.createdAt, "PPpp")}
            </span>
          </div>
        </div>
      </div>

      <!-- Scrollable content -->
      <div class="flex-1 overflow-y-auto p-6 custom-scrollbar">
        <div class="result-title prose max-w-none">
          {@html getItemPreview(selectedItem, true)}
        </div>
      </div>
    {:else}
      <div class="flex h-full items-center justify-center flex-col gap-4">
        <svg class="w-16 h-16 opacity-30 result-subtitle" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <span class="result-title text-lg font-medium">Select an item to view details</span>
      </div>
    {/if}
  </div>
</SplitView>

<style>
  .custom-scrollbar {
    scrollbar-width: thin;
  }
</style>
