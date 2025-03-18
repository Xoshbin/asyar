<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { format } from "date-fns";
  import { clipboardViewState } from "./state";
  import { SplitView } from "asyar-api";

  
  let listContainer: HTMLDivElement;
  let isActive = false;

  // Subscribe to state
  $: items = $clipboardViewState.items;
  $: selectedItem = $clipboardViewState.selectedItem;
  $: selectedIndex = $clipboardViewState.selectedIndex;
  $: isLoading = $clipboardViewState.isLoading;
  $: loadError = $clipboardViewState.loadError;
  $: errorMessage = $clipboardViewState.errorMessage;

  onMount(async () => {
    isActive = true;
    window.addEventListener("keydown", handleKeydown);
  });

  function handleKeydown(event: KeyboardEvent) {
    if (!isActive || !items.length) return;

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      clipboardViewState.moveSelection(event.key === "ArrowUp" ? 'up' : 'down');
      ensureSelectedVisible();
    } else if (event.key === "Enter" && selectedItem) {
      event.preventDefault();
      event.stopPropagation();
      clipboardViewState.handleItemAction(selectedItem, 'paste');
    }
  }

  async function handleItemClick(item: ClipboardHistoryItem) {
    await clipboardViewState.simulatePaste(item.id);
    clipboardViewState.hidePanel();
  }

  function ensureSelectedVisible() {
    requestAnimationFrame(() => {
      const element = listContainer?.querySelector(`[data-index="${selectedIndex}"]`);
      if (element) {
        const containerRect = listContainer.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();

        const isAbove = elementRect.top < containerRect.top;
        const isBelow = elementRect.bottom > containerRect.bottom;

        if (isAbove || isBelow) {
          element.scrollIntoView({
            block: isAbove ? 'start' : 'end',
            behavior: 'smooth'
          });
        }
      }
    });
  }

  function selectItem(index: number) {
    clipboardViewState.setSelectedItem(index);
  }

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
    isActive = false;
  });

  async function clearHistory() {
    if (confirm("Are you sure you want to clear all non-favorite items?")) {
      await clipboardService.clearHistory();
      // Refresh the list
      allItems = await clipboardService.getHistory(100);
      clipboardViewState.initFuse(allItems);
      items = allItems;
    }
  }

  async function toggleFavorite(item: ClipboardHistoryItem, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    
    if (!item || !item.id) return;

    await clipboardService.toggleFavorite(item.id);
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
      logService.info(`No content available for item ${item?.id}`);
      return '<span class="text-gray-400">No preview available</span>';
    }
    
    switch (item.type) {
      case "image":
        // Log the image content for debugging
        logService.info(`Rendering image for item ${item.id}, content length: ${item.content.length}`);
        
        // Extract base64 data - handle both with and without data URI prefix
        let imgSrc = item.content;
        
        // Clean up the data URI if needed (some images have "data:image/png;base64, " with an extra space)
        imgSrc = imgSrc.replace("data:image/png;base64, ", "data:image/png;base64,");
        
        // Make sure we have the proper data URI format
        if (!imgSrc.startsWith('data:')) {
          imgSrc = `data:image/png;base64,${imgSrc}`;
          LogService.debug(`Fixed image source by adding data URI prefix for item ${item.id}`);
        }
        
        // Check if the image data starts with placeholder "AAAAAAAA" which indicates a broken image
        if (imgSrc.includes('AAAAAAAA')) {
          LogService.debug(`Detected placeholder image data for item ${item.id}`);
          return '<div class="flex items-center justify-center p-4 bg-gray-100 rounded"><svg class="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg></div>';
        }
        
        // For debug purpose, let's log what we're trying to render
        LogService.debug(`Image source (prefix): ${imgSrc.substring(0, Math.min(30, imgSrc.length))}...`);
        
        // Handle full display mode differently from thumbnail
        if (full) {
          return `<div class="image-container w-full flex items-center justify-center">
            <img 
              src="${imgSrc}" 
              class="max-w-full max-h-[70vh] object-contain border border-[var(--border-color)] rounded" 
              alt="Clipboard image ${new Date(item.createdAt).toLocaleString()}"
              onerror="this.onerror=null; this.style.display='none'; this.parentNode.innerHTML='<div class=\\'flex p-8 items-center justify-center bg-gray-100 rounded\\'><div class=\\'text-center\\'><svg class=\\'mx-auto w-16 h-16 text-gray-400 mb-4\\' fill=\\'none\\' stroke=\\'currentColor\\' viewBox=\\'0 0 24 24\\'><path stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\' stroke-width=\\'1.5\\' d=\\'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z\\' /></svg><div class=\\'text-gray-500\\'>Failed to load image</div></div></div>'; console.error('Full image failed to load:', '${item.id}');"
            />
          </div>`;
        } else {
          // Thumbnail version
          return `<div class="w-16 h-16 flex items-center justify-center overflow-hidden bg-gray-50 rounded">
            <img 
              src="${imgSrc}" 
              class="max-w-full max-h-full object-cover" 
              alt="Thumbnail"
              onerror="this.onerror=null; this.style.display='none'; this.parentNode.innerHTML='<svg class=\\'w-8 h-8 text-gray-400\\' fill=\\'none\\' stroke=\\'currentColor\\' viewBox=\\'0 0 24 24\\'><path stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\' stroke-width=\\'1.5\\' d=\\'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z\\' /></svg>'; console.error('Thumbnail failed to load:', '${item.id}');"
            />
          </div>`;
        }
      
      case "text":
        const textPreview = full ? item.content : item.content.substring(0, 100) + (item.content.length > 100 ? '...' : '');
        return full ? `<pre class="whitespace-pre-wrap break-words">${textPreview}</pre>` : textPreview;
      
      case "html":
        if (full) {
          // Return HTML as plain text for inspection
          return `<pre class="whitespace-pre-wrap break-words text-sm font-mono">${item.content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')}</pre>`;
        }
        return `<div class="text-xs italic">[HTML Content]</div>`;
      
      default:
        return `[${item.type} content]`;
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

  function refreshHistory() {
    isLoading = true;
    loadError = false;
    
    setTimeout(async () => {
      try {
        allItems = await ExtensionApi.clipboard.getHistory(100);
        clipboardViewState.initFuse(allItems);
        items = allItems;
      } catch (error) {
        loadError = true;
        errorMessage = `Failed to refresh clipboard history: ${error}`;
        LogService.error(errorMessage);
      } finally {
        isLoading = false;
      }
    }, 300);
  }
</script>

<SplitView leftWidth={300} minLeftWidth={200} maxLeftWidth={600}>
  <div 
    slot="left" 
    bind:this={listContainer}
    class="h-full overflow-y-auto focus:outline-none scroll-smooth"
    tabindex="0"
    on:keydown={handleKeydown}
  >
  <div class="divide-y divide-[var(--border-color)]">
    {#each items as item, index (item.id)}
      <div
        data-index={index}
        class="result-item relative"
        class:selected-result={selectedIndex === index}
        on:click={() => selectItem(index)}
        on:dblclick={() => clipboardViewState.handleItemAction(item, 'paste')}
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
  .scroll-smooth {
    scroll-behavior: smooth;
  }
  .custom-scrollbar {
    scrollbar-width: thin;
  }
</style>