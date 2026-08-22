<script lang="ts">
  import { stat } from '@tauri-apps/plugin-fs';
  import { openPath } from '@tauri-apps/plugin-opener';
  import {
    SplitListDetail,
    EmptyState,
    LauncherListRow,
    Badge,
    ActionFooter,
  } from '../../components';
  import { searchBarAccessoryService } from '../../services/search/searchBarAccessoryService.svelte';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { logService } from '../../services/log/logService';
  import {
    fileSearchViewState,
    runSearch,
    recordSelectionForCurrentQuery,
    type TypeFilter,
  } from './state.svelte';
  import type { FileHit } from 'asyar-sdk/contracts';
  import { t } from '../../services/i18n';
  import { primeAiChipForFile } from './aiChipBridge';
  import { getFileThumbnail } from '../../lib/ipc/thumbnailCommands';
  import { readTextPreview } from '../../lib/ipc/fileSearchCommands';

  const ROW_THUMB_DIM = 56; // 2x a 28px row icon, for retina
  const DETAIL_THUMB_DIM = 800;
  // Types with a Rust thumbnail strategy (image: cross-platform; the rest:
  // macOS qlmanage only today — `null` comes back everywhere else, and the
  // existing metadata/text fallback is used).
  const THUMBNAILABLE_TYPES = new Set(['image', 'audio-video', 'archive', 'other']);

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key !== 'Tab') return;
    if (!selected) return;
    event.preventDefault();
    void primeAiChipForFile(selected);
  }

  function formatBytes(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function formatRelativeTime(modifiedAt: number): string {
    const ageSec = Math.floor(Date.now() / 1000) - modifiedAt;
    if (ageSec < 60) return 'just now';
    if (ageSec < 3600) return `${Math.floor(ageSec / 60)} min ago`;
    if (ageSec < 86400) return `${Math.floor(ageSec / 3600)} h ago`;
    const days = Math.floor(ageSec / 86400);
    if (days < 30) return `${days} d ago`;
    if (days < 365) return `${Math.floor(days / 30)} mo ago`;
    return `${Math.floor(days / 365)} y ago`;
  }

  // Subscribe to the searchBarAccessory dropdown
  $effect(() => {
    const off = searchBarAccessoryService.subscribe(
      'file-search',
      'show-files',
      (value: string) => {
        fileSearchViewState.setTypeFilter(value as TypeFilter);
        void runSearch();
      },
    );
    return off;
  });

  // Re-run search when the query changes
  $effect(() => {
    const _q = fileSearchViewState.searchQuery;
    void runSearch();
  });

  let items = $derived(fileSearchViewState.allItems.map((r) => ({ ...r, id: r.fileId })));
  let selectedId = $derived(fileSearchViewState.selectedFileId);
  let selectedIndex = $derived(items.findIndex((i) => i.fileId === selectedId));
  let selected = $derived(items.find((i) => i.fileId === selectedId));
  let pinnedIds = $derived(new Set(fileSearchViewState.pinnedFiles.map((p) => p.fileId)));

  // Row-list thumbnails: fileId -> url (present+truthy), or null (requested,
  // none available). Absence of a key means "not yet requested".
  //
  // Images only, deliberately. Anything else falls through to `qlmanage`
  // on macOS — a real subprocess spawn that loads Quick Look generator
  // plugins, not a cheap call. `document`/`code` are usually the majority
  // of a $HOME result set and already have a fast text preview, so
  // blanket-requesting thumbnails for every row (as an earlier version of
  // this did) meant a `qlmanage` spawn per newly-visible non-image file on
  // every keystroke — the actual source of the CPU/heat this was causing.
  // The detail pane still gets the richer qlmanage-backed preview, but
  // only for the one currently-selected file, not up to 50 rows at once.
  let rowThumbnails = $state<Record<string, string | null>>({});
  let rowThumbTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const current = items;
    clearTimeout(rowThumbTimer);
    // Debounced: typing quickly (or a fast-narrowing query) replaces the
    // visible set many times a second — no reason to request a thumbnail
    // for a row that's about to be replaced before the request even lands.
    rowThumbTimer = setTimeout(() => {
      for (const item of current) {
        if (item.type !== 'image' || item.fileId in rowThumbnails) continue;
        void requestRowThumbnail(item.fileId, item.path);
      }
    }, 120);
    return () => clearTimeout(rowThumbTimer);
  });

  async function requestRowThumbnail(fileId: string, path: string) {
    const url = await getFileThumbnail(path, ROW_THUMB_DIM);
    rowThumbnails[fileId] = url;
  }

  // Detail pane state
  let detailThumbnailUrl = $state<string | null>(null);
  let detailThumbnailLoading = $state(false);
  let currentThumbnailPath = $state('');
  let textPreview = $state('');
  let textPreviewLoading = $state(false);
  let currentTextPath = $state('');
  // `FileHit` doesn't carry size — the preview pane stats the one selected
  // file lazily instead of keeping it in the hot per-keystroke struct.
  let selectedSize = $state<number | null>(null);

  const MAX_TEXT_PREVIEW = 50_000;
  let detailThumbTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const item = selected;
    const wantsThumbnail = item && THUMBNAILABLE_TYPES.has(item.type);
    clearTimeout(detailThumbTimer);
    if (wantsThumbnail && item.path !== currentThumbnailPath) {
      // Debounced: holding an arrow key steps through many rows a second.
      // Non-image thumbnails here go through `qlmanage` — without this,
      // scrolling through 20 archive/video files fires 20 subprocess spawns
      // for files the user only glanced at for a few milliseconds each.
      detailThumbTimer = setTimeout(() => void loadDetailThumbnail(item.path), 150);
    } else if (!wantsThumbnail) {
      detailThumbnailUrl = null;
      currentThumbnailPath = '';
    }

    const isText = item && (item.type === 'document' || item.type === 'code');
    if (isText && item.path !== currentTextPath) {
      void loadText(item.path);
    } else if (!isText) {
      textPreview = '';
      currentTextPath = '';
    }

    if (item && !item.isDir) {
      void loadSize(item.path);
    } else {
      selectedSize = null;
    }

    return () => clearTimeout(detailThumbTimer);
  });

  async function loadDetailThumbnail(path: string) {
    detailThumbnailLoading = true;
    currentThumbnailPath = path;
    try {
      detailThumbnailUrl = await getFileThumbnail(path, DETAIL_THUMB_DIM);
    } finally {
      detailThumbnailLoading = false;
    }
  }

  async function loadText(path: string) {
    textPreviewLoading = true;
    currentTextPath = path;
    try {
      // Rust-side read (bounded, via std::fs) — not subject to the
      // webview's fs capability scope, which never covered arbitrary
      // $HOME paths in the first place.
      textPreview = (await readTextPreview(path, MAX_TEXT_PREVIEW)) ?? '';
    } catch (err) {
      logService.warn(`[FileSearch] text load failed: ${err}`);
      textPreview = '';
    } finally {
      textPreviewLoading = false;
    }
  }

  async function loadSize(path: string) {
    try {
      const meta = await stat(path);
      selectedSize = meta.size;
    } catch {
      selectedSize = null;
    }
  }

  function onSelect(item: FileHit) {
    fileSearchViewState.selectedFileId = item.fileId;
  }

  async function onActivate(item: FileHit) {
    try {
      await recordSelectionForCurrentQuery(item.fileId);
    } catch (err) {
      feedbackService.report({
        source: 'frontend',
        kind: 'file-search/record-selection-failed',
        severity: 'warning',
        retryable: false,
        developerDetail: String(err),
      });
    }
    try {
      await openPath(item.path);
    } catch (err) {
      feedbackService.report({
        source: 'frontend',
        kind: 'file-search/open-failed',
        severity: 'error',
        retryable: false,
        developerDetail: String(err),
      });
    }
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="view-container">
  <SplitListDetail
    {items}
    {selectedIndex}
    leftWidth={320}
    minLeftWidth={240}
    maxLeftWidth={600}
    ariaLabel="Files"
    emptyMessage={fileSearchViewState.searchQuery ? 'No matches' : 'Start typing to search…'}
  >
    {#snippet listItem(item: FileHit, index: number)}
      <LauncherListRow
        data-index={index}
        selected={selectedIndex === index}
        onclick={() => onSelect(item)}
        ondblclick={() => onActivate(item)}
        title={item.name}
        subtitle={item.path}
      >
        {#snippet leading()}
          <div class="row-icon-wrap">
            {#if rowThumbnails[item.fileId]}
              <img src={rowThumbnails[item.fileId]} alt="" class="row-thumb" />
            {:else if item.type === 'image'}
              <svg class="row-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                ><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle
                  cx="8.5"
                  cy="8.5"
                  r="1.5"
                /><polyline points="21 15 16 10 5 21" /></svg
              >
            {:else if item.type === 'code'}
              <svg class="row-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                ><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg
              >
            {:else if item.type === 'audio-video'}
              <svg class="row-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                ><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle
                  cx="18"
                  cy="16"
                  r="3"
                /></svg
              >
            {:else if item.type === 'archive'}
              <svg class="row-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                ><polyline points="21 8 21 21 3 21 3 8" /><rect
                  x="1"
                  y="3"
                  width="22"
                  height="5"
                /><line x1="10" y1="12" x2="14" y2="12" /></svg
              >
            {:else if item.type === 'folder'}
              <svg class="row-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                ><path
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                /></svg
              >
            {:else if item.type === 'document'}
              <svg class="row-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                ><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline
                  points="14 2 14 8 20 8"
                /><line x1="16" y1="13" x2="8" y2="13" /><line
                  x1="16"
                  y1="17"
                  x2="8"
                  y2="17"
                /></svg
              >
            {:else}
              <svg class="row-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                ><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline
                  points="14 2 14 8 20 8"
                /></svg
              >
            {/if}
          </div>
        {/snippet}
        {#snippet trailing()}
          {#if item.source === 'deep'}
            <Badge text="deep" variant="default" mono />
          {:else if pinnedIds.has(item.fileId)}
            <svg class="pin-badge" fill="currentColor" viewBox="0 0 24 24" aria-label="Pinned">
              <path
                d="M16 2v5l2 2-4 4v4l-2-2-2 2v-4L6 9l2-2V2h8zm0-2H8v6.17L4.83 9.34a1 1 0 000 1.41L8 13.92V18a1 1 0 00.55.89l2 1a1 1 0 00.9 0l2-1A1 1 0 0014 18v-4.08l3.17-3.17a1 1 0 000-1.41L16 6.17V0z"
              />
            </svg>
          {/if}
        {/snippet}
      </LauncherListRow>
    {/snippet}

    {#snippet detail()}
      {#if selected}
        <div class="preview-pane custom-scrollbar">
          {#if selected.type === 'document' || selected.type === 'code'}
            <div class="text-pane">
              {#if textPreviewLoading}
                <div class="text-caption opacity-50">Loading…</div>
              {:else if textPreview}
                <pre class="text-preview">{textPreview}</pre>
              {:else}
                <div class="text-caption opacity-50">No preview available</div>
              {/if}
            </div>
          {:else if selected.type === 'folder'}
            <div class="text-caption opacity-70 p-4">Folder — {selected.path}</div>
          {:else if THUMBNAILABLE_TYPES.has(selected.type)}
            <div class="image-pane">
              {#if detailThumbnailLoading}
                <div class="text-caption opacity-50">Loading preview…</div>
              {:else if detailThumbnailUrl}
                <img src={detailThumbnailUrl} alt="" class="preview-image" />
              {:else}
                <div class="text-caption opacity-70 p-4">
                  {selected.type}{selectedSize !== null ? ` · ${formatBytes(selectedSize)}` : ''}
                </div>
              {/if}
            </div>
          {:else}
            <div class="text-caption opacity-70 p-4">
              {selected.type}{selectedSize !== null ? ` · ${formatBytes(selectedSize)}` : ''}
            </div>
          {/if}
        </div>

        <ActionFooter>
          {#snippet left()}
            <div class="flex items-center space-x-3">
              <Badge text={selected.type} variant="default" mono />
              {#if selectedSize !== null}
                <span class="text-caption">{formatBytes(selectedSize)}</span>
              {/if}
              <span class="text-caption opacity-70">{formatRelativeTime(selected.modifiedAt)}</span>
              <span class="text-caption opacity-50 truncate" style="max-width:300px;"
                >{selected.path}</span
              >
            </div>
          {/snippet}
        </ActionFooter>
      {:else}
        <EmptyState
          message={fileSearchViewState.searchQuery
            ? t('features.file_search.select_file_preview')
            : t('features.file_search.start_typing_files')}
        >
          {#snippet icon()}
            <svg class="empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
              <circle cx="11" cy="13" r="3" />
              <line x1="13.5" y1="15.5" x2="16" y2="18" />
            </svg>
          {/snippet}
        </EmptyState>
      {/if}
    {/snippet}
  </SplitListDetail>
</div>

<style>
  .view-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .row-icon-wrap {
    width: var(--size-lg);
    height: var(--size-lg);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    opacity: 0.6;
  }

  .row-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: var(--radius-sm);
  }

  .row-icon {
    width: 20px;
    height: 20px;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .pin-badge {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    color: var(--accent-primary);
    opacity: 0.7;
  }

  .empty-icon {
    width: 48px;
    height: 48px;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.4;
    color: var(--text-tertiary);
  }

  .preview-pane {
    flex: 1;
    overflow: auto;
    padding: var(--space-6);
    contain: layout paint;
    min-width: 0;
  }

  .image-pane {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .preview-image {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
  }

  .text-pane {
    width: 100%;
  }

  .text-preview {
    font-family: var(--font-mono);
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    font-size: var(--font-size-sm);
    line-height: 1.6;
  }
</style>
