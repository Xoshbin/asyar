<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { clipboardViewState, onViewActivated, onSearchChanged, onScrolledToEnd, fetchFullItemForId, visibleItems } from "./state.svelte";
  import { clipboardHistoryStore } from "../../services/clipboard/stores/clipboardHistoryStore.svelte";
  import { listen } from "@tauri-apps/api/event";
  import { fetchRawHtml } from "./urlFetcher";
  import { stripRtf, type ClipboardHistoryItem } from "asyar-sdk/contracts";
  import type { StoredClipboardItem } from "../../lib/ipc/commands";
  import { readFile } from "@tauri-apps/plugin-fs";
  import { revealItemInDir } from "@tauri-apps/plugin-opener";
  import { renderMarkdown, handleMarkdownCopyClick } from "../../utils/markdown";
  import { renderMermaidDiagrams } from "../../utils/mermaid";
  import {
    SplitListDetail,
    EmptyState,
    LauncherListRow,
    Badge,
    ActionFooter,
  } from "../../components";
  import { searchBarAccessoryService } from "../../services/search/searchBarAccessoryService.svelte";
  import { diagnosticsService } from "../../services/diagnostics/diagnosticsService.svelte";
  import { logService } from "../../services/log/logService";

  const detailDateFormat = new Intl.DateTimeFormat('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
  });

  function timeSection(timestamp: number): string {
    const d = new Date(timestamp);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const itemDay = new Date(d);
    itemDay.setHours(0, 0, 0, 0);
    const diffDays = Math.round((today.getTime() - itemDay.getTime()) / 86400000);
    if (diffDays <= 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return 'This week';
    if (d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear()) return 'This month';
    return 'Older';
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
  
  let detailEl = $state<HTMLElement | null>(null);
  let listWrapperEl = $state<HTMLElement | null>(null);

  let showRenderedHtml = $derived(clipboardViewState.showRenderedHtml);

  // Mirror the store's currently-visible window (searchResults ?? favorites
  // + recent) into clipboardViewState.items so the existing filteredItems
  // derivation and the keyboard handler in index.ts always see the same
  // data as the rendered list.
  $effect(() => {
    const store = clipboardHistoryStore;
    const next = store.searchResults
      ?? [...store.favorites, ...store.recent];
    clipboardViewState.items = next as unknown as ClipboardHistoryItem[];
  });

  // SINGLE source of truth: clipboardViewState.filteredItems (the local
  // store-mirrored items plus type filter). The keyboard handler in
  // index.ts also reads from this, so the rendered list and arrow-key
  // navigation now operate on the exact same array.
  let items = $derived(clipboardViewState.filteredItems);
  let selectedId = $derived(clipboardViewState.selectedItemId);
  let selectedIndex = $derived(items.findIndex(i => i.id === selectedId));
  let favoritesCount = $derived(items.filter(i => i.favorite).length);

  // When the visible list changes (search swap, type-filter change, store
  // refresh), the previously selected id may no longer be in `items` — the
  // highlight + detail pane go out of sync. Reset to the first visible row
  // so selection always tracks the visible list.
  $effect(() => {
    const list = items;
    if (list.length === 0) {
      if (selectedId !== null) clipboardViewState.selectedItemId = null;
      return;
    }
    if (!list.some(i => i.id === selectedId)) {
      clipboardViewState.selectedItemId = list[0].id;
    }
  });

  // Full item (content decrypted) fetched lazily when selection changes
  let selectedFullItem = $state<StoredClipboardItem | null>(null);
  $effect(() => {
    const id = clipboardViewState.selectedItemId;
    if (!id) { selectedFullItem = null; return; }
    void fetchFullItemForId(id).then(full => {
      if (clipboardViewState.selectedItemId === id) {
        selectedFullItem = full;
      }
    }).catch(err => {
      diagnosticsService.report({
        source: 'frontend', kind: 'clipboard/get-item-failed', severity: 'error',
        retryable: false, developerDetail: String(err),
      });
    });
  });

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

  // Attach scroll listener (capture, since scroll doesn't bubble) to detect
  // near-bottom scrolling and trigger pagination.
  $effect(() => {
    const wrapper = listWrapperEl;
    if (!wrapper) return;
    wrapper.addEventListener('scroll', handleListScroll, { capture: true });
    return () => wrapper.removeEventListener('scroll', handleListScroll, { capture: true });
  });

  // Load the initial window on first activation if the store is empty.
  $effect(() => { void onViewActivated(); });

  // Mirror the search query into the store's search so FTS is used.
  $effect(() => { void onSearchChanged(clipboardViewState.searchQuery); });

  // Re-run the current search when the FTS index becomes ready.
  $effect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        unlisten = await listen('clipboard:fts-ready', () => {
          clipboardHistoryStore.indexState = 'ready';
          const q = clipboardViewState.searchQuery.trim();
          if (q) void onSearchChanged(q);
        });
      } catch (err) {
        diagnosticsService.report({
          source: 'frontend', kind: 'clipboard/fts-listener-failed', severity: 'error',
          retryable: false, developerDetail: String(err),
        });
      }
    })();
    return () => { unlisten?.(); };
  });

  // Mermaid Rendering Effect
  $effect(() => {
    // Re-run when selection or view mode changes
    const _item = selectedFullItem;
    const _rendered = showRenderedHtml;

    if (detailEl) {
      tick().then(() => renderMermaidDiagrams(detailEl!));
    }
  });

  // Load image via readFile when an image item is selected
  $effect(() => {
    const item = selectedFullItem;
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
    const item = selectedFullItem;
    if (!item || !isUrl(item.content) || !showRenderedHtml) {
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
      logService.warn(`[ClipboardHistory] Failed to load image: ${e}`);
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = '';
    } finally {
      imageLoading = false;
    }
  }

  function selectItem(id: string) {
    clipboardViewState.selectedItemId = id;
  }

  function handleListScroll(e: Event) {
    const el = e.currentTarget as HTMLElement;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      void onScrolledToEnd();
    }
  }

  async function pasteItemById(id: string) {
    try {
      const full = await fetchFullItemForId(id);
      if (full) {
        await clipboardViewState.handleItemAction(full as unknown as ClipboardHistoryItem, 'paste');
      }
    } catch (err) {
      diagnosticsService.report({
        source: 'frontend', kind: 'clipboard/paste-failed', severity: 'error',
        retryable: false, developerDetail: String(err),
      });
    }
  }

  function getItemTitle(item: { type: string; preview?: string }) {
    const preview = item.preview ?? '';
    if (!preview) return item.type === "image" ? "Image" : item.type === "files" ? "Files" : "Empty";
    return preview.substring(0, 200).replace(/\n/g, " ").trim() || "Empty";
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

  function getWordCount(item: { type: string; content?: string }): number {
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

  function getMetadataText(item: { type: string; content?: string; metadata?: Record<string, unknown> }): string {
    const meta = item.metadata;
    if (item.type === 'image' && meta) {
      const parts: string[] = [];
      if (meta.width && meta.height) {
        parts.push(`${meta.width}\u00d7${meta.height}`);
      }
      if (meta.sizeBytes) {
        parts.push(formatBytes(meta.sizeBytes as number));
      }
      return parts.join(' \u00b7 ') || '';
    }
    if (item.type === 'files' && meta?.fileCount) {
      return `${meta.fileCount} file${(meta.fileCount as number) !== 1 ? 's' : ''}`;
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

</script>

<div class="view-container">
  {#if clipboardHistoryStore.indexState === 'indexing' && clipboardViewState.searchQuery.trim()}
    <div class="indexing-hint">Indexing… search results will appear when ready</div>
  {/if}
  <div class="split-list-wrapper" bind:this={listWrapperEl}>
  <SplitListDetail
    items={items}
    {selectedIndex}
    leftWidth={260}
    minLeftWidth={200}
    maxLeftWidth={600}
    ariaLabel="Clipboard Items"
    emptyMessage="No items found"
  >
    {#snippet listItem(item, index)}
      {#if index === 0 && favoritesCount > 0}
        <div class="list-section">Pinned</div>
      {/if}
      {@const isFirstNonFavorite = index === favoritesCount && index < items.length}
      {@const prevItem = index > favoritesCount ? items[index - 1] : null}
      {@const sectionLabel = !item.favorite ? timeSection(item.createdAt) : null}
      {@const showDayHeader = !item.favorite && (isFirstNonFavorite || (prevItem && timeSection(prevItem.createdAt) !== sectionLabel))}
      {#if showDayHeader && sectionLabel}
        <div class="list-section">{sectionLabel}</div>
      {/if}
      <LauncherListRow
        data-index={index}
        selected={selectedIndex === index}
        onclick={() => selectItem(item.id)}
        ondblclick={() => pasteItemById(item.id)}
        title={getItemTitle(item)}
        subtitle={clipboardViewState.searchQuery && 'score' in item
          ? `Match: ${Math.round((1 - (typeof item.score === 'number' ? item.score : 0)) * 100)}%`
          : undefined}
      >
        {#snippet leading()}
          <div class="mr-1 flex-shrink-0 flex items-center justify-center opacity-60">
            {#if item.type === 'image'}
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
            {:else if item.type === 'files'}
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
            {:else if item.type === 'html'}
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>
            {:else if item.type === 'rtf'}
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            {:else}
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"/></svg>
            {/if}
          </div>
        {/snippet}
      </LauncherListRow>
    {/snippet}

    {#snippet detail()}
      {#if selectedId}
        {#if showRenderedHtml && isUrl(selectedFullItem?.content) && urlBlobUrl}
          <iframe
            src={urlBlobUrl}
            class="url-iframe"
            sandbox="allow-scripts"
            title="URL preview"
          ></iframe>
        {:else}
        <div class="clip-detail-content custom-scrollbar" bind:this={detailEl}>

          {#if !selectedFullItem}
            <span style="color: var(--text-tertiary)">Loading…</span>
          {:else if !selectedFullItem.content}
            <span style="color: var(--text-tertiary)">No preview available</span>
          {:else if selectedFullItem.type === 'image'}
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
              {#if selectedFullItem.metadata && (selectedFullItem.metadata.width || selectedFullItem.metadata.sizeBytes)}
                <div class="mt-3 text-caption opacity-70 flex items-center gap-3">
                  {#if selectedFullItem.metadata.width && selectedFullItem.metadata.height}
                    <span>{selectedFullItem.metadata.width} × {selectedFullItem.metadata.height}</span>
                  {/if}
                  {#if selectedFullItem.metadata.sizeBytes}
                    <span>{formatBytes(selectedFullItem.metadata.sizeBytes as number)}</span>
                  {/if}
                </div>
              {/if}
            </div>
          {:else if selectedFullItem.type === 'html'}
            {#if showRenderedHtml}
              <div class="html-preview">
                {@html sanitizeHtml(selectedFullItem.content)}
              </div>
            {:else}
              <pre class="source-preview">{getSourcePreview(selectedFullItem.content)}</pre>
              {#if isContentTruncated(selectedFullItem.content)}
                <div class="truncation-notice">Showing first {MAX_PREVIEW_CHARS.toLocaleString()} of {selectedFullItem.content.length.toLocaleString()} characters</div>
              {/if}
            {/if}
          {:else if selectedFullItem.type === 'rtf'}
            {#if showRenderedHtml}
              <pre class="source-preview">{stripRtf(selectedFullItem.content)}</pre>
            {:else}
              <pre class="source-preview">{getSourcePreview(selectedFullItem.content)}</pre>
            {/if}
            {#if isContentTruncated(selectedFullItem.content)}
              <div class="truncation-notice">Showing first {MAX_PREVIEW_CHARS.toLocaleString()} of {selectedFullItem.content.length.toLocaleString()} characters</div>
            {/if}
          {:else if selectedFullItem.type === 'files'}
            <div class="flex flex-col gap-1.5 p-4">
              {#each getFiles(selectedFullItem.content) as filePath}
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
          {:else if showRenderedHtml && isUrl(selectedFullItem.content)}
            {#if urlLoading}
              <div class="url-loading">
                <div class="url-loading-header">
                  <div class="url-domain">{getUrlDomain(selectedFullItem.content)}</div>
                  <div class="url-full">{selectedFullItem.content.trim()}</div>
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
                <div class="url-domain">{getUrlDomain(selectedFullItem.content)}</div>
                <div class="url-full">{selectedFullItem.content.trim()}</div>
                {#if urlFetchFailed}
                  <div class="url-fetch-notice">Preview unavailable</div>
                {/if}
              </div>
            {/if}
          {:else}
            {#if showRenderedHtml}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="md-content" onclick={handleMarkdownCopyClick}>
                {@html renderMarkdown(selectedFullItem.content)}
              </div>
              {#if isContentTruncated(selectedFullItem.content)}
                <div class="truncation-notice">Showing first {MAX_PREVIEW_CHARS.toLocaleString()} of {selectedFullItem.content.length.toLocaleString()} characters</div>
              {/if}
            {:else}
              <pre class="source-preview">{getSourcePreview(selectedFullItem.content)}</pre>
              {#if isContentTruncated(selectedFullItem.content)}
                <div class="truncation-notice">Showing first {MAX_PREVIEW_CHARS.toLocaleString()} of {selectedFullItem.content.length.toLocaleString()} characters</div>
              {/if}
            {/if}
          {/if}
        </div>
        {/if}

        <ActionFooter>
          {#snippet left()}
            <div class="flex items-center space-x-3">
              {#if selectedFullItem}
                <Badge text={selectedFullItem.type} variant="default" mono />
                <span class="flex items-center gap-1 text-caption">
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  {formatDetailDate(selectedFullItem.createdAt)}
                </span>
                {#if getMetadataText(selectedFullItem)}
                  <span class="text-caption opacity-70">
                    {getMetadataText(selectedFullItem)}
                  </span>
                {/if}
                {#if selectedFullItem.sourceApp}
                  <span class="source-app-info">
                    {#if (selectedFullItem.sourceApp as any).iconUrl}
                      <img
                        src={(selectedFullItem.sourceApp as any).iconUrl}
                        class="source-app-icon"
                        alt=""
                        aria-hidden="true"
                      />
                    {:else}
                      <svg class="source-app-icon-fallback" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                      </svg>
                    {/if}
                    <span class="source-app-name">{(selectedFullItem.sourceApp as any).name}</span>
                    {#if (selectedFullItem.sourceApp as any).windowTitle}
                      <span class="source-app-title">{(selectedFullItem.sourceApp as any).windowTitle}</span>
                    {/if}
                  </span>
                {/if}
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
</div>

<style>
  .view-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .indexing-hint {
    padding: var(--space-1) var(--space-5);
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    background: var(--bg-secondary);
    text-align: center;
    flex-shrink: 0;
  }

  .split-list-wrapper {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .clip-detail-content {
    flex: 1;
    overflow: auto;
    padding: var(--space-6);
    position: relative;
    contain: layout paint;
    min-width: 0;
  }

  .source-preview {
    font-family: var(--font-mono);
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    font-size: var(--font-size-md);
    line-height: 1.6;
  }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: var(--font-size-sm);
  }

  .action-btn:hover {
    color: var(--text-primary);
    background: var(--bg-secondary);
  }

  .truncation-notice {
    padding: var(--space-3) 0;
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
    padding: var(--space-8) var(--space-9) var(--space-6);
    border-bottom: 1px solid var(--separator);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
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
    padding: var(--space-9) var(--space-9);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .skeleton-line {
    height: 14px;
    border-radius: var(--radius-xs);
    background: var(--bg-tertiary);
    animation: skeleton-pulse 1.5s ease-in-out infinite;
  }

  .skeleton-block {
    height: 80px;
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
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
    background: white;
  }

  .url-fetch-notice {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    margin-top: var(--space-1);
  }

  .url-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-5);
    height: 100%;
    padding: var(--space-9);
    text-align: center;
  }

  .url-icon {
    color: var(--accent-primary);
    opacity: 0.7;
  }

  .url-domain {
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--text-primary);
  }

  .url-full {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    word-break: break-all;
    max-width: 100%;
    padding: var(--space-3) var(--space-5);
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
    position: relative;
    isolation: isolate;
    max-width: 100%;
  }

  :global(.html-preview *) {
    color: inherit !important;
    background-color: transparent !important;
    background: transparent !important;
    /* Pasted HTML often carries position:fixed/absolute that's relative to the
       viewport — neutralise it so positioned descendants stay inside the
       preview's scroll box. */
    position: static !important;
    float: none !important;
    max-width: 100% !important;
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
    padding: 2px var(--space-2);
  }

  :global(.html-preview pre) {
    padding: var(--space-5) var(--space-6);
    overflow-x: auto;
  }



  .source-app-info {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .source-app-icon {
    width: var(--space-6);
    height: var(--space-6);
    object-fit: contain;
    border-radius: var(--radius-xs);
    flex-shrink: 0;
  }

  .source-app-icon-fallback {
    width: var(--space-6);
    height: var(--space-6);
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
