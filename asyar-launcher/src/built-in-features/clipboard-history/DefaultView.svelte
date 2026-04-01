<script lang="ts">
  import { format } from "date-fns";
  import { clipboardViewState } from "./state.svelte";
  import type { ClipboardHistoryItem } from "asyar-sdk";
  import { convertFileSrc } from "@tauri-apps/api/core";
  import {
    SplitListDetail,
    EmptyState,
    ListItem,
    Badge,
    ActionFooter,
    KeyboardHint,
    SegmentedControl,
    ListItemActions,
    ConfirmDialog,
  } from "../../components";

  // ConfirmDialog state
  let confirmOpen = $state(false);
  let pendingDeleteId = $state<string | null>(null);
  let pendingDeleteName = $state<string | null>(null);

  // Type filter options
  const filterOptions = [
    { value: "all", label: "All" },
    { value: "text", label: "Text" },
    { value: "images", label: "Images" },
    { value: "files", label: "Files" },
  ];

  // Derive filtered items: first apply type filter, then search
  let typeFilteredItems = $derived(clipboardViewState.getTypeFilteredItems());
  let filteredItems = $derived(clipboardViewState.filtered
    ? clipboardViewState.search(typeFilteredItems, clipboardViewState.searchQuery)
    : typeFilteredItems);
  let selectedItem = $derived(clipboardViewState.selectedItem);
  let selectedIndex = $derived(clipboardViewState.selectedIndex);

  function selectItem(index: number) {
    clipboardViewState.setSelectedItem(index);
  }

  function getItemTitle(item: ClipboardHistoryItem) {
    if (!item || !item.content) return "Empty";
    if (item.type === "image") return "Image";
    if (item.type === "files") {
      try {
        const paths: string[] = JSON.parse(item.content);
        const names = paths.map(p => p.split('/').pop() || p.split('\\').pop() || p);
        return names.join(', ');
      } catch {
        return "Files";
      }
    }
    if (item.type === "rtf") return item.preview || item.content.substring(0, 100);
    return item.content.replace(/\n/g, " ").trim();
  }

  function getItemIcon(type: string): string {
    switch (type) {
      case 'image': return 'image';
      case 'html': return 'html';
      case 'rtf': return 'rtf';
      case 'files': return 'files';
      default: return 'text';
    }
  }

  function getDetailPreview(item: ClipboardHistoryItem): string {
    if (!item || !item.content) {
      return '<span style="color: var(--text-tertiary)">No preview available</span>';
    }
    switch (item.type) {
      case "image": {
        const src = convertFileSrc(item.content);
        return `<div class="image-container w-full h-full flex flex-col items-center justify-center p-4">
          <img src="${src}" class="max-w-full max-h-full object-contain rounded-md shadow-sm border" style="border-color: var(--border-color);" alt="Preview" loading="lazy"/>
        </div>`;
      }
      case "files": {
        try {
          const paths: string[] = JSON.parse(item.content);
          const fileItems = paths.map(p => {
            const name = p.split('/').pop() || p.split('\\').pop() || p;
            return `<div class="flex items-center gap-2 py-1.5 px-2 rounded" style="background: var(--bg-secondary);">
              <svg class="w-4 h-4 flex-shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
              <span class="text-sm truncate" style="color: var(--text-primary); font-family: var(--font-mono);">${name}</span>
            </div>`;
          }).join('');
          return `<div class="flex flex-col gap-1.5 p-4">${fileItems}</div>`;
        } catch {
          return '<span style="color: var(--text-tertiary)">[Invalid file data]</span>';
        }
      }
      case "html":
      case "rtf":
      case "text":
      default: {
        const safeContent = item.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<pre style="font-family: var(--font-mono); color: var(--text-primary);" class="whitespace-pre-wrap break-words text-[13px] leading-relaxed">${safeContent}</pre>`;
      }
    }
  }

  function getMetadataText(item: ClipboardHistoryItem): string {
    if (item.type === 'image' && item.metadata) {
      const parts: string[] = [];
      if (item.metadata.width && item.metadata.height) {
        parts.push(`${item.metadata.width}×${item.metadata.height}`);
      }
      if (item.metadata.sizeBytes) {
        parts.push(formatBytes(item.metadata.sizeBytes));
      }
      return parts.join(' · ') || '';
    }
    if (item.type === 'files' && item.metadata?.fileCount) {
      return `${item.metadata.fileCount} file${item.metadata.fileCount !== 1 ? 's' : ''}`;
    }
    if (item.content) {
      return `${item.content.length} chars`;
    }
    return '';
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Delete handlers (following Snippets pattern)
  function handleDelete(item: ClipboardHistoryItem) {
    pendingDeleteId = item.id;
    pendingDeleteName = item.type === 'image' ? 'Image' : (item.content?.substring(0, 40) || 'item');
    confirmOpen = true;
  }

  async function handleConfirmDelete() {
    if (!pendingDeleteId) return;
    await clipboardViewState.deleteItem(pendingDeleteId);
    pendingDeleteId = null;
    pendingDeleteName = null;
  }

  async function handleToggleFavorite(e: MouseEvent, item: ClipboardHistoryItem) {
    e.stopPropagation();
    await clipboardViewState.toggleFavorite(item.id);
    await clipboardViewState.refreshHistory();
  }
</script>

<div class="view-container">
  <div class="filter-bar">
    <SegmentedControl
      options={filterOptions}
      bind:value={clipboardViewState.typeFilter}
    />
  </div>

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
              <img
                src={convertFileSrc(item.content || '')}
                alt=""
                class="w-8 h-8 rounded object-cover"
                loading="lazy"
                onerror={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            {:else if item.type === 'files'}
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
            {:else if item.type === 'html'}
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>
            {:else if item.type === 'rtf'}
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            {:else}
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"/></svg>
            {/if}
          </div>
        {/snippet}
        {#snippet subtitle()}
          <span class="flex items-center gap-1.5">
            {#if item.favorite}
              <span class="text-yellow-500" title="Favorite">★</span>
            {/if}
            {#if clipboardViewState.searchQuery && 'score' in item}
              Match: {Math.round((1 - (typeof item.score === 'number' ? item.score : 0)) * 100)}%
            {:else}
              {format(item.createdAt, "MMM d, yyyy · p")}
            {/if}
          </span>
        {/snippet}
        {#snippet trailing()}
          <ListItemActions>
            <button
              class="action-btn"
              onclick={(e) => handleToggleFavorite(e, item)}
              title={item.favorite ? "Remove from favorites" : "Add to favorites"}
            >
              {#if item.favorite}
                <svg class="w-3.5 h-3.5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
              {:else}
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/></svg>
              {/if}
            </button>
            <button
              class="action-btn action-btn-danger"
              onclick={(e) => { e.stopPropagation(); handleDelete(item); }}
              title="Delete item"
            >✕</button>
          </ListItemActions>
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
              {#if getMetadataText(selectedItem)}
                <span class="text-caption opacity-70">
                  {getMetadataText(selectedItem)}
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

  <ConfirmDialog
    bind:isOpen={confirmOpen}
    title="Delete clipboard item"
    message={`Delete "${pendingDeleteName}"? This cannot be undone.`}
    confirmButtonText="Delete"
    variant="danger"
    onconfirm={handleConfirmDelete}
    oncancel={() => { pendingDeleteId = null; pendingDeleteName = null; }}
  />
</div>

<style>
  .filter-bar {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .clip-detail-content {
    flex: 1;
    overflow-y: auto;
    padding: 24px 32px;
  }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: color var(--transition-fast), background var(--transition-fast);
  }

  .action-btn:hover {
    color: var(--text-primary);
    background: var(--bg-secondary);
  }

  .action-btn-danger:hover {
    color: var(--accent-danger);
  }
</style>
