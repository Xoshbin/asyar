<script lang="ts">
  import { clipboardViewState } from "./state.svelte";
  import { fetchRawHtml } from "./urlFetcher";
  import { stripRtf, type ClipboardHistoryItem } from "asyar-sdk/contracts";
  import { readFile } from "@tauri-apps/plugin-fs";
  import { revealItemInDir } from "@tauri-apps/plugin-opener";
  import { marked } from "marked";
  import {
    SplitListDetail,
    EmptyState,
    ListItem,
    Badge,
    ActionFooter,
    ListItemActions,
  } from "../../components";
  import { feedbackService } from "../../services/feedback/feedbackService.svelte";
  import { searchBarAccessoryService } from "../../services/search/searchBarAccessoryService.svelte";
  import { diagnosticsService } from "../../services/diagnostics/diagnosticsService.svelte";
  import { logService } from "../../services/log/logService";

  const listDateFormat = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });

  const detailDateFormat = new Intl.DateTimeFormat('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
  });

  function formatRelativeDate(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (seconds < 60) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return listDateFormat.format(timestamp);
  }

  function formatDetailDate(timestamp: number): string {
    return detailDateFormat.format(timestamp);
  }


  // Image loading state
  let imageLoading = $state(false);
  let imageUrl = $state('');
  let currentImagePath = $state('');

  // URL content fetch state
  let urlBlobUrl = $state('');
  let urlLoading = $state(false);
  let urlFetchFailed = $state(false);
  let currentFetchedUrl = $state('');

  let showRenderedHtml = $derived(clipboardViewState.showRenderedHtml);

  // Derive filtered items from state (type filter + search applied there)
  let filteredItems = $derived(clipboardViewState.filteredItems);
  let selectedItem = $derived(clipboardViewState.selectedItem);
  let selectedIndex = $derived(clipboardViewState.selectedIndex);
  let favoritesCount = $derived(filteredItems.filter(i => i.favorite).length);

  // Subscribe to the searchbar-accessory service so the user's dropdown
  // selection (declared via the manifest's `searchBarAccessory`) flows
  // into the existing typeFilter state. The launcher's view-mount
  // lifecycle (ExtensionViewContainer) auto-declares the accessory from
  // the manifest, so this consumer only needs to subscribe.
  $effect(() => {
    const off = searchBarAccessoryService.subscribe(
      "clipboard-history",
      "show-clipboard",
      (value) => {
        clipboardViewState.setTypeFilter(value);
      },
    );
    return off;
  });

  // Load image via readFile when an image item is selected
  $effect(() => {
    const item = selectedItem;
    if (item?.type === 'image' && item.content && item.content !== currentImagePath) {
      loadImage(item.content);
    } else if (!item || item.type !== 'image') {
      // Clean up blob URL when switching away from image
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
        imageUrl = '';
      }
      currentImagePath = '';
      imageLoading = false;
    }
  });

  // Fetch URL content when a URL item is selected
  $effect(() => {
    const item = selectedItem;
    if (!item || !isUrl(item.content)) {
      if (currentFetchedUrl) {
        if (urlBlobUrl) { URL.revokeObjectURL(urlBlobUrl); urlBlobUrl = ''; }
        urlLoading = false;
        urlFetchFailed = false;
        currentFetchedUrl = '';
      }
      return;
    }
    const url = item.content!.trim();
    if (url === currentFetchedUrl) return;

    // Revoke previous blob URL
    if (urlBlobUrl) { URL.revokeObjectURL(urlBlobUrl); urlBlobUrl = ''; }

    currentFetchedUrl = url;
    urlFetchFailed = false;
    urlLoading = true;

    const network = clipboardViewState.networkService;
    if (!network) { urlLoading = false; urlFetchFailed = true; return; }

    fetchRawHtml(url, network).then((result) => {
      if (currentFetchedUrl !== url) return; // stale
      if (result.status === 'ok') {
        const blob = new Blob([result.html], { type: 'text/html' });
        urlBlobUrl = URL.createObjectURL(blob);
      } else {
        urlFetchFailed = true;
      }
      urlLoading = false;
    });
  });

  async function loadImage(path: string) {
    imageLoading = true;
    currentImagePath = path;
    try {
      const data = await readFile(path);
      const blob = new Blob([data], { type: 'image/png' });
      // Revoke previous URL
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = URL.createObjectURL(blob);
    } catch (e) {
      console.error('Failed to load image:', e);
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = '';
    } finally {
      imageLoading = false;
    }
  }

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
    if (item.type === "html") {
      const text = item.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return text.substring(0, 200) || "HTML";
    }
    if (item.type === "rtf") return stripRtf(item.content).substring(0, 200) || "RTF";
    // Only process first 200 chars — CSS truncates the rest anyway
    return item.content.substring(0, 200).replace(/\n/g, " ").trim();
  }

  function sanitizeHtml(html: string): string {
    // Cap rendered HTML to prevent DOM overload
    let clean = html.length > MAX_PREVIEW_CHARS ? html.substring(0, MAX_PREVIEW_CHARS) : html;
    clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    clean = clean.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    // Strip <style> tags to prevent theme conflicts
    clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    return clean;
  }

  const MAX_PREVIEW_CHARS = 50000;

  function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function getSourcePreview(content: string): string {
    if (content.length <= MAX_PREVIEW_CHARS) {
      return escapeHtml(content);
    }
    return escapeHtml(content.substring(0, MAX_PREVIEW_CHARS));
  }

  function isContentTruncated(content: string): boolean {
    return content.length > MAX_PREVIEW_CHARS;
  }

  function renderMarkdown(text: string): string {
    const input = text.length > MAX_PREVIEW_CHARS ? text.substring(0, MAX_PREVIEW_CHARS) : text;
    return marked.parse(input, { async: false, breaks: true }) as string;
  }

  function getFileName(path: string): string {
    return path.split('/').pop() || path.split('\\').pop() || path;
  }

  function getFiles(content: string | null | undefined): string[] {
    try {
      return JSON.parse(content || '[]');
    } catch {
      return [];
    }
  }

  function isUrl(text: string | null | undefined): boolean {
    if (!text) return false;
    const trimmed = text.trim();
    return /^https?:\/\/[^\s]+$/.test(trimmed) && !trimmed.includes('\n');
  }

  function getUrlDomain(url: string): string {
    try {
      return new URL(url.trim()).hostname;
    } catch {
      return url.trim();
    }
  }

  async function revealFile(path: string) {
    try {
      await revealItemInDir(path);
    } catch (error) {
      logService.error(`Failed to reveal file ${path}: ${error}`);
      diagnosticsService.report({
        source: 'frontend', kind: 'manual', severity: 'error',
        retryable: false,
        context: { message: `Could not reveal ${path} in Finder` },
      });
    }
  }

  function getWordCount(item: ClipboardHistoryItem): number {
    if (!item.content) return 0;
    let text = item.content;
    if (item.type === 'html') {
      const div = document.createElement('div');
      div.innerHTML = item.content;
      text = div.textContent || div.innerText || '';
    } else if (item.type === 'rtf') {
      text = stripRtf(item.content);
    }
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
  }

  function getMetadataText(item: ClipboardHistoryItem): string {
    if (item.type === 'image' && item.metadata) {
      const parts: string[] = [];
      if (item.metadata.width && item.metadata.height) {
        parts.push(`${item.metadata.width}\u00d7${item.metadata.height}`);
      }
      if (item.metadata.sizeBytes) {
        parts.push(formatBytes(item.metadata.sizeBytes));
      }
      return parts.join(' \u00b7 ') || '';
    }
    if (item.type === 'files' && item.metadata?.fileCount) {
      return `${item.metadata.fileCount} file${item.metadata.fileCount !== 1 ? 's' : ''}`;
    }
    if (item.content && ['text', 'html', 'rtf'].includes(item.type)) {
      const words = getWordCount(item);
      return `${words} word${words !== 1 ? 's' : ''} \u00b7 ${item.content.length} chars`;
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

  async function handleDelete(item: ClipboardHistoryItem) {
    const name = item.type === 'image' ? 'Image' : (item.content?.substring(0, 40) || 'item');
    const confirmed = await feedbackService.confirmAlert({
      title: 'Delete clipboard item',
      message: `Delete "${name}"? This cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    await clipboardViewState.deleteItem(item.id);
  }

  async function handleToggleFavorite(e: MouseEvent, item: ClipboardHistoryItem) {
    e.stopPropagation();
    await clipboardViewState.toggleFavorite(item.id);
    await clipboardViewState.refreshHistory();
  }
</script>

<div class="view-container">
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
      {#if index === 0 && favoritesCount > 0}
        <div class="section-header">Pinned</div>
      {/if}
      {#if index === favoritesCount && favoritesCount > 0}
        <div class="section-header">Recent</div>
      {/if}
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
              {formatRelativeDate(item.createdAt)}
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
              <span class="star-icon" class:active={item.favorite}>★</span>
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
        {#if isUrl(selectedItem.content) && urlBlobUrl}
          <iframe
            src={urlBlobUrl}
            class="url-iframe"
            sandbox="allow-scripts"
            title="URL preview"
          ></iframe>
        {:else}
        <div class="clip-detail-content custom-scrollbar">

          {#if !selectedItem.content}
            <span style="color: var(--text-tertiary)">No preview available</span>
          {:else if selectedItem.type === 'image'}
            <div class="image-container w-full h-full flex flex-col items-center justify-center p-4">
              {#if imageLoading}
                <div class="text-caption opacity-50">Loading image...</div>
              {:else if imageUrl}
                <img
                  src={imageUrl}
                  class="max-w-full max-h-full object-contain rounded-md shadow-sm border"
                  style="border-color: var(--border-color);"
                  alt="Preview"
                />
              {:else}
                <div class="text-caption opacity-50">Failed to load image</div>
              {/if}
              {#if selectedItem.metadata && (selectedItem.metadata.width || selectedItem.metadata.sizeBytes)}
                <div class="mt-3 text-caption opacity-70 flex items-center gap-3">
                  {#if selectedItem.metadata.width && selectedItem.metadata.height}
                    <span>{selectedItem.metadata.width} × {selectedItem.metadata.height}</span>
                  {/if}
                  {#if selectedItem.metadata.sizeBytes}
                    <span>{formatBytes(selectedItem.metadata.sizeBytes)}</span>
                  {/if}
                </div>
              {/if}
            </div>
          {:else if selectedItem.type === 'html'}
            {#if showRenderedHtml}
              <div class="html-preview">
                {@html sanitizeHtml(selectedItem.content)}
              </div>
            {:else}
              <pre class="source-preview">{getSourcePreview(selectedItem.content)}</pre>
              {#if isContentTruncated(selectedItem.content)}
                <div class="truncation-notice">Showing first {MAX_PREVIEW_CHARS.toLocaleString()} of {selectedItem.content.length.toLocaleString()} characters</div>
              {/if}
            {/if}
          {:else if selectedItem.type === 'rtf'}
            {#if showRenderedHtml}
              <pre class="source-preview">{stripRtf(selectedItem.content)}</pre>
            {:else}
              <pre class="source-preview">{getSourcePreview(selectedItem.content)}</pre>
            {/if}
            {#if isContentTruncated(selectedItem.content)}
              <div class="truncation-notice">Showing first {MAX_PREVIEW_CHARS.toLocaleString()} of {selectedItem.content.length.toLocaleString()} characters</div>
            {/if}
          {:else if selectedItem.type === 'files'}
            <div class="flex flex-col gap-1.5 p-4">
              {#each getFiles(selectedItem.content) as filePath}
                <div class="flex items-center gap-2 py-1.5 px-2 rounded" style="background: var(--bg-secondary);">
                  <svg class="w-4 h-4 flex-shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                  <span class="text-sm truncate flex-1" style="color: var(--text-primary); font-family: var(--font-mono);">{getFileName(filePath)}</span>
                  <button
                    class="action-btn"
                    onclick={() => revealFile(filePath)}
                    title="Reveal in Finder"
                  >
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                  </button>
                </div>
              {/each}
            </div>
          {:else if isUrl(selectedItem.content)}
            {#if urlLoading}
              <div class="url-loading">
                <div class="url-loading-header">
                  <div class="url-domain">{getUrlDomain(selectedItem.content)}</div>
                  <div class="url-full">{selectedItem.content.trim()}</div>
                </div>
                <div class="url-progress-bar"><div class="url-progress-fill"></div></div>
                <div class="url-skeleton">
                  <div class="skeleton-line" style="width:88%"></div>
                  <div class="skeleton-line" style="width:72%"></div>
                  <div class="skeleton-line" style="width:60%"></div>
                  <div class="skeleton-block"></div>
                  <div class="skeleton-line" style="width:80%"></div>
                  <div class="skeleton-line" style="width:65%"></div>
                </div>
              </div>
            {:else}
              <div class="url-preview">
                <div class="url-icon">
                  <svg class="w-10 h-10 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>
                </div>
                <div class="url-domain">{getUrlDomain(selectedItem.content)}</div>
                <div class="url-full">{selectedItem.content.trim()}</div>
                {#if urlFetchFailed}
                  <div class="url-fetch-notice">Preview unavailable</div>
                {/if}
              </div>
            {/if}
          {:else}
            {#if showRenderedHtml}
              <div class="markdown-preview">
                {@html renderMarkdown(selectedItem.content)}
              </div>
              {#if isContentTruncated(selectedItem.content)}
                <div class="truncation-notice">Showing first {MAX_PREVIEW_CHARS.toLocaleString()} of {selectedItem.content.length.toLocaleString()} characters</div>
              {/if}
            {:else}
              <pre class="source-preview">{getSourcePreview(selectedItem.content)}</pre>
              {#if isContentTruncated(selectedItem.content)}
                <div class="truncation-notice">Showing first {MAX_PREVIEW_CHARS.toLocaleString()} of {selectedItem.content.length.toLocaleString()} characters</div>
              {/if}
            {/if}
          {/if}
        </div>
        {/if}

        <ActionFooter>
          {#snippet left()}
            <div class="flex items-center space-x-3">
              <Badge text={selectedItem.type} variant="default" mono />
              <span class="flex items-center gap-1 text-caption">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                {formatDetailDate(selectedItem.createdAt)}
              </span>
              {#if getMetadataText(selectedItem)}
                <span class="text-caption opacity-70">
                  {getMetadataText(selectedItem)}
                </span>
              {/if}
              {#if selectedItem.sourceApp}
                <span class="source-app-info">
                  {#if selectedItem.sourceApp.iconUrl}
                    <img
                      src={selectedItem.sourceApp.iconUrl}
                      class="source-app-icon"
                      alt=""
                      aria-hidden="true"
                    />
                  {:else}
                    <svg class="source-app-icon-fallback" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                    </svg>
                  {/if}
                  <span class="source-app-name">{selectedItem.sourceApp.name}</span>
                  {#if selectedItem.sourceApp.windowTitle}
                    <span class="source-app-title">{selectedItem.sourceApp.windowTitle}</span>
                  {/if}
                </span>
              {/if}
            </div>
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
</div>

<style>
  .section-header {
    padding: 6px 12px 4px;
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .clip-detail-content {
    flex: 1;
    overflow-y: auto;
    padding: 24px 32px;
  }

  .source-preview {
    font-family: var(--font-mono);
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 13px;
    line-height: 1.6;
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
    font-size: 12px;
  }

  .action-btn:hover {
    color: var(--text-primary);
    background: var(--bg-secondary);
  }

  .action-btn-danger:hover {
    color: var(--accent-danger);
  }

  .star-icon {
    font-size: 14px;
    color: var(--text-tertiary);
  }

  .star-icon.active {
    color: #eab308;
  }

  .truncation-notice {
    padding: 8px 0;
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    font-style: italic;
  }

  .url-loading {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .url-loading-header {
    padding: 24px 32px 16px;
    border-bottom: 1px solid var(--separator);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .url-progress-bar {
    height: 2px;
    background: var(--bg-secondary);
    overflow: hidden;
  }

  .url-progress-fill {
    height: 100%;
    width: 40%;
    background: var(--accent-primary);
    animation: url-progress 1.2s ease-in-out infinite;
  }

  @keyframes url-progress {
    0%   { transform: translateX(-100%); }
    100% { transform: translateX(350%); }
  }

  .url-skeleton {
    padding: 28px 32px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .skeleton-line {
    height: 14px;
    border-radius: 4px;
    background: var(--bg-tertiary, var(--bg-secondary));
    animation: skeleton-pulse 1.5s ease-in-out infinite;
  }

  .skeleton-block {
    height: 80px;
    border-radius: 6px;
    background: var(--bg-tertiary, var(--bg-secondary));
    animation: skeleton-pulse 1.5s ease-in-out infinite;
    animation-delay: 0.3s;
  }

  @keyframes skeleton-pulse {
    0%, 100% { opacity: 0.4; }
    50%       { opacity: 0.8; }
  }

  .url-iframe {
    flex: 1;
    width: 100%;
    height: 100%;
    border: none;
    background: #fff;
  }

  .url-fetch-notice {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    margin-top: 4px;
  }

  .url-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    height: 100%;
    padding: 32px;
    text-align: center;
  }

  .url-icon {
    color: var(--accent-primary);
    opacity: 0.7;
  }

  .url-domain {
    font-size: var(--font-size-lg, 18px);
    font-weight: 600;
    color: var(--text-primary);
  }

  .url-full {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    word-break: break-all;
    max-width: 100%;
    padding: 8px 12px;
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
  }

/* HTML rendered preview — force app theme colors over inline styles */
  .html-preview {
    font-family: var(--font-ui);
    font-size: var(--font-size-sm);
    line-height: 1.6;
    overflow-wrap: break-word;
    color: var(--text-primary);
    background: transparent;
  }

  :global(.html-preview *) {
    color: inherit !important;
    background-color: transparent !important;
    background: transparent !important;
  }

  :global(.html-preview a) {
    color: var(--accent-primary) !important;
  }

  :global(.html-preview img) {
    max-width: 100%;
    height: auto;
  }

  :global(.html-preview pre),
  :global(.html-preview code) {
    background-color: var(--bg-secondary) !important;
    color: var(--text-primary) !important;
    border-radius: var(--radius-sm);
    padding: 2px 6px;
  }

  :global(.html-preview pre) {
    padding: 12px 16px;
    overflow-x: auto;
  }

  /* Markdown rendered preview */
  .markdown-preview {
    font-family: var(--font-ui);
    font-size: var(--font-size-sm);
    line-height: 1.7;
    overflow-wrap: break-word;
    color: var(--text-primary);
  }

  :global(.markdown-preview h1),
  :global(.markdown-preview h2),
  :global(.markdown-preview h3),
  :global(.markdown-preview h4),
  :global(.markdown-preview h5),
  :global(.markdown-preview h6) {
    color: var(--text-primary);
    margin: 1em 0 0.5em;
    line-height: 1.3;
  }

  :global(.markdown-preview h1) { font-size: 1.5em; }
  :global(.markdown-preview h2) { font-size: 1.3em; }
  :global(.markdown-preview h3) { font-size: 1.15em; }

  :global(.markdown-preview p) {
    margin: 0.5em 0;
  }

  :global(.markdown-preview a) {
    color: var(--accent-primary);
  }

  :global(.markdown-preview code) {
    background-color: var(--bg-secondary);
    color: var(--text-primary);
    border-radius: var(--radius-sm);
    padding: 2px 6px;
    font-family: var(--font-mono);
    font-size: 0.9em;
  }

  :global(.markdown-preview pre) {
    background-color: var(--bg-secondary);
    border-radius: var(--radius-sm);
    padding: 12px 16px;
    overflow-x: auto;
    margin: 0.75em 0;
  }

  :global(.markdown-preview pre code) {
    background: none;
    padding: 0;
  }

  :global(.markdown-preview blockquote) {
    border-left: 3px solid var(--border-color);
    margin: 0.75em 0;
    padding: 0.25em 1em;
    color: var(--text-secondary);
  }

  :global(.markdown-preview ul),
  :global(.markdown-preview ol) {
    padding-left: 1.5em;
    margin: 0.5em 0;
  }

  :global(.markdown-preview li) {
    margin: 0.25em 0;
  }

  :global(.markdown-preview hr) {
    border: none;
    border-top: 1px solid var(--border-color);
    margin: 1em 0;
  }

  :global(.markdown-preview table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.75em 0;
  }

  :global(.markdown-preview th),
  :global(.markdown-preview td) {
    border: 1px solid var(--border-color);
    padding: 6px 12px;
    text-align: left;
  }

  :global(.markdown-preview th) {
    background-color: var(--bg-secondary);
    font-weight: 600;
  }

  :global(.markdown-preview img) {
    max-width: 100%;
    height: auto;
  }

  .source-app-info {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .source-app-icon {
    width: 16px;
    height: 16px;
    object-fit: contain;
    border-radius: var(--radius-xs);
    flex-shrink: 0;
  }

  .source-app-icon-fallback {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    opacity: 0.5;
  }

  .source-app-name {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .source-app-title {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    max-width: 128px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
