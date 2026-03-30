<script lang="ts">
import { format } from "date-fns";
import { clipboardViewState } from "./state.svelte";
import { onMount, tick } from "svelte";
import type { ClipboardHistoryItem } from "asyar-sdk";
import SplitView from "../../components/list/SplitView.svelte";

let listContainer = $state<HTMLDivElement>();

// onMount no longer needs to use ExtensionManager to mount the SplitView
onMount(async () => {
  await tick();
});

let filteredItems = $derived(clipboardViewState.filtered
  ? clipboardViewState.search(clipboardViewState.items, clipboardViewState.searchQuery)
  : clipboardViewState.items);
let selectedItem = $derived(clipboardViewState.selectedItem);
let selectedIndex = $derived(clipboardViewState.selectedIndex);

function ensureSelectedVisible() {
  requestAnimationFrame(() => {
    const element = listContainer?.querySelector(`[data-index="${selectedIndex}"]`);
    if (element && listContainer) {
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
  clipboardViewState.setSelectedItem(index);
}

$effect(() => {
  if (selectedIndex !== undefined) {
    ensureSelectedVisible();
  }
});

function getItemTitle(item: ClipboardHistoryItem) {
  if (!item || !item.content) return "Empty";
  if (item.type === "image") {
    return "Image Data";
  }
  return item.content.replace(/\n/g, " ").trim();
}

function getTypeIcon(type: string, isSelected: boolean) {
  const color = isSelected ? "currentColor" : "var(--icon-color, #888)";
  switch(type) {
    case "image":
      return `<svg class="w-4 h-4" style="color: ${color}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>`;
    case "html":
      return `<svg class="w-4 h-4" style="color: ${color}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>`;
    default: // text
      return `<svg class="w-4 h-4" style="color: ${color}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"/></svg>`;
  }
}

function getDetailPreview(item: ClipboardHistoryItem) {
  if (!item || !item.content) {
    return '<span style="color: var(--text-tertiary)">No preview available</span>';
  }
  
  switch (item.type) {
    case "image":
      let imgSrc = item.content.replace("data:image/png;base64, ", "data:image/png;base64,");
      if (!imgSrc.startsWith('data:')) {
        imgSrc = `data:image/png;base64,${imgSrc}`;
      }
      if (imgSrc.includes('AAAAAAAA')) {
        return '<div style="color: var(--text-tertiary)">Broken image</div>';
      }
      return `<div class="image-container w-full h-full flex flex-col items-center justify-center p-4">
        <img src="${imgSrc}" class="max-w-full max-h-full object-contain rounded-md shadow-sm border" style="border-color: var(--border-color);" alt="Preview"/>
      </div>`;
    case "html":
    case "text":
    default:
      const safeContent = item.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<pre style="font-family: var(--font-mono); color: var(--text-primary);" class="whitespace-pre-wrap break-words text-[13px] leading-relaxed">${safeContent}</pre>`;
  }
}
</script>

<SplitView leftWidth={260} minLeftWidth={200} maxLeftWidth={600}>
  {#snippet left()}
    <div 
      bind:this={listContainer}
      class="h-full overflow-y-auto focus:outline-none bg-[var(--bg-primary)] py-2 border-r border-[var(--separator)] custom-scrollbar"
      role="listbox"
      aria-label="Clipboard Items"
      tabindex="0"
    >
      {#if filteredItems.length === 0}
        <div class="p-4 text-center text-sm text-gray-500">No items found</div>
      {:else}
        {#each filteredItems as item, index (item.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_interactive_supports_focus -->
          <div
            data-index={index}
            class="group flex items-center px-3 py-2 mx-2 my-0.5 rounded-lg cursor-default transition-colors {selectedIndex === index ? 'bg-[var(--accent-primary)] text-white shadow-sm' : 'hover:bg-[var(--bg-hover)] text-[var(--text-primary)]'}"
            role="option"
            aria-selected={selectedIndex === index}
            onclick={() => selectItem(index)}
            ondblclick={() => clipboardViewState.handleItemAction(item, 'paste')}
          >
            <div class="mr-3 flex-shrink-0 flex items-center justify-center">
              {@html getTypeIcon(item.type, selectedIndex === index)}
            </div>
            <div class="flex-1 overflow-hidden flex flex-col justify-center gap-0.5">
              <div class="truncate text-[13px] font-medium leading-none {selectedIndex === index ? 'text-white' : 'text-[var(--text-primary)]'}">
                {getItemTitle(item)}
              </div>
              <div class="truncate text-[11px] leading-none {selectedIndex === index ? 'text-white/70' : 'text-[var(--text-secondary)]'}">
                {#if clipboardViewState.searchQuery && 'score' in item}
                  Match: {Math.round((1 - (typeof item.score === 'number' ? item.score : 0)) * 100)}%
                {:else}
                  {format(item.createdAt, "MMM d, yyyy · p")}
                {/if}
              </div>
            </div>
            {#if selectedIndex === index}
              <div class="ml-2 flex-shrink-0 text-white opacity-90 text-[10px] font-medium tracking-wide">
                ↵
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  {/snippet}

  {#snippet right()}
    <div class="h-full flex flex-col bg-[var(--bg-secondary)] overflow-hidden relative">
      {#if selectedItem}
        <div class="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
          {@html getDetailPreview(selectedItem)}
        </div>

        <!-- Action Footer -->
        <div class="h-12 border-t border-[var(--separator)] bg-[var(--bg-primary)]/80 backdrop-blur-md flex items-center px-4 justify-between text-xs text-[var(--text-secondary)] shadow-sm z-10">
          <div class="flex items-center space-x-3">
            <span class="font-medium uppercase tracking-wider text-[10px] bg-[var(--bg-tertiary)] px-2 py-0.5 rounded">
              {selectedItem.type}
            </span>
            <span class="flex items-center gap-1">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              {format(selectedItem.createdAt, "PPpp")}
            </span>
            {#if selectedItem.type !== 'image'}
              <span class="flex items-center gap-1">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"/></svg>
                {selectedItem.content?.length || 0} chars
              </span>
            {/if}
          </div>
          <div class="flex items-center gap-1.5 opacity-80 font-medium">
            <kbd class="px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-secondary)] font-sans shadow-sm">Enter</kbd> 
            <span>to Paste</span>
          </div>
        </div>
      {:else}
        <div class="flex h-full items-center justify-center flex-col gap-4 text-[var(--text-tertiary)]">
          <svg class="w-16 h-16 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <span class="text-sm font-medium">Select an item to view details</span>
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
