<script lang="ts">
  import { format } from "date-fns";
  import { clipboardViewState } from "./state.svelte";
  import type { ClipboardHistoryItem } from "asyar-sdk";
  import {
    SplitListDetail,
    EmptyState,
    ListItem,
    Badge,
    ActionFooter,
    KeyboardHint
  } from "../../components";

  let filteredItems = $derived(clipboardViewState.filtered
    ? clipboardViewState.search(clipboardViewState.items, clipboardViewState.searchQuery)
    : clipboardViewState.items);
  let selectedItem = $derived(clipboardViewState.selectedItem);
  let selectedIndex = $derived(clipboardViewState.selectedIndex);

  function selectItem(index: number) {
    clipboardViewState.setSelectedItem(index);
  }

  function getItemTitle(item: ClipboardHistoryItem) {
    if (!item || !item.content) return "Empty";
    if (item.type === "image") {
      return "Image Data";
    }
    return item.content.replace(/\n/g, " ").trim();
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

<SplitListDetail
  items={filteredItems}
  {selectedIndex}
  leftWidth={260}
  minLeftWidth={200}
  maxLeftWidth={600}
  ariaLabel="Clipboard Items"
  emptyMessage="No items found"
>
  {#snippet listItem(item, index)}
    <ListItem
      data-index={index}
      selected={selectedIndex === index}
      onclick={() => selectItem(index)}
      ondblclick={() => clipboardViewState.handleItemAction(item, 'paste')}
      title={getItemTitle(item)}
    >
      {#snippet leading()}
        <div class="mr-1 flex-shrink-0 flex items-center justify-center opacity-60">
          {#if item.type === 'image'}
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
          {:else if item.type === 'html'}
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>
          {:else}
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"/></svg>
          {/if}
        </div>
      {/snippet}
      {#snippet subtitle()}
        {#if clipboardViewState.searchQuery && 'score' in item}
          Match: {Math.round((1 - (typeof item.score === 'number' ? item.score : 0)) * 100)}%
        {:else}
          {format(item.createdAt, "MMM d, yyyy · p")}
        {/if}
      {/snippet}
      {#snippet trailing()}
        {#if selectedIndex === index}
          <kbd class="opacity-50">↵</kbd>
        {/if}
      {/snippet}
    </ListItem>
  {/snippet}

  {#snippet detail()}
    {#if selectedItem}
      <div class="clip-detail-content custom-scrollbar">
        {@html getDetailPreview(selectedItem)}
      </div>

      <ActionFooter>
        {#snippet left()}
          <div class="flex items-center space-x-3">
            <Badge text={selectedItem.type} variant="default" mono />
            <span class="flex items-center gap-1 text-caption">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              {format(selectedItem.createdAt, "PPpp")}
            </span>
            {#if selectedItem.type !== 'image'}
              <span class="flex items-center gap-1 text-caption">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"/></svg>
                {selectedItem.content?.length || 0} chars
              </span>
            {/if}
          </div>
        {/snippet}
        {#snippet right()}
          <KeyboardHint keys="Enter" action="to Paste" />
        {/snippet}
      </ActionFooter>
    {:else}
      <EmptyState message="Select an item to view details">
        {#snippet icon()}
          <svg class="w-16 h-16 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        {/snippet}
      </EmptyState>
    {/if}
  {/snippet}
</SplitListDetail>

<style>
  .clip-detail-content {
    flex: 1;
    overflow-y: auto;
    padding: 24px 32px;
  }
</style>
