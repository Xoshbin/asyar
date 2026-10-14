<script lang="ts">
  import type { FileHit } from 'asyar-sdk/contracts';
  import { Badge, EmptyState, Icon, LauncherListRow, SplitListDetail } from '../../components';
  import { fileIcons, openerPathPreview } from '../../lib/ipc/commands';
  import { readTextPreview } from '../../lib/ipc/fileSearchCommands';
  import { getBuiltInIconName, isIconImage } from '../../lib/iconUtils';
  import { getFileThumbnail } from '../../lib/ipc/thumbnailCommands';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { t } from '../../services/i18n';
  import { logService } from '../../services/log/logService';
  import { openerService } from '../../services/opener/openerService';
  import { searchBarAccessoryService } from '../../services/search/searchBarAccessoryService.svelte';
  import { primeAiChipForFile } from './aiChipBridge';
  import {
    fileSearchViewState,
    recordSelectionForCurrentQuery,
    runSearch,
    type TypeFilter,
  } from './state.svelte';

  const ROW_THUMB_DIM = 56; // 2x a 28px row icon, for retina
  const DETAIL_THUMB_DIM = 800;

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

  const dateFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  function formatDate(d: Date | null | undefined): string {
    return d ? dateFormat.format(d) : '—';
  }

  const TYPE_LABEL_KEYS: Record<string, string> = {
    document: 'features.file_search.ui.kind_document',
    image: 'features.file_search.ui.kind_image',
    code: 'features.file_search.ui.kind_code',
    'audio-video': 'features.file_search.ui.kind_audio_video',
    archive: 'features.file_search.ui.kind_archive',
  };
  function kindOf(item: FileHit): string {
    if (item.isDir) return t('features.file_search.ui.folder');
    const ext = item.name.includes('.') ? item.name.split('.').pop()!.toUpperCase() : '';
    const label = t(TYPE_LABEL_KEYS[item.type] ?? 'features.file_search.ui.kind_file');
    return ext ? `${label} (${ext})` : label;
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

  // Raycast-style rows show only the name; when two visible rows share one,
  // the parent folder is prefixed (dimmed) to tell them apart.
  let duplicateNames = $derived.by(() => {
    const seen = new Map<string, number>();
    for (const i of items) seen.set(i.name, (seen.get(i.name) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([name]) => name));
  });
  function prefixOf(item: FileHit): string | undefined {
    if (!duplicateNames.has(item.name)) return undefined;
    const parent = item.path.split(/[\\/]/).slice(-2, -1)[0];
    return parent ? `${parent}/` : undefined;
  }

  // Native Finder/Explorer icons, keyed by path; batched + debounced like
  // thumbnails. Rust caches plain files per extension, so this is cheap.
  let rowIcons = $state<Record<string, string>>({});
  let rowIconTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const missing = items.filter((i) => !(i.path in rowIcons)).map((i) => i.path);
    clearTimeout(rowIconTimer);
    if (missing.length === 0) return;
    rowIconTimer = setTimeout(async () => {
      try {
        const icons = await fileIcons(missing);
        missing.forEach((path, i) => (rowIcons[path] = icons[i]));
      } catch (err) {
        logService.warn(`[FileSearch] icon load failed: ${err}`);
      }
    }, 80);
    return () => clearTimeout(rowIconTimer);
  });
  function iconOf(item: FileHit): string {
    return (
      rowThumbnails[item.fileId] ||
      rowIcons[item.path] ||
      (item.isDir ? 'icon:folder' : 'icon:file-text')
    );
  }

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

  // Detail pane state — one unified preview chain, no extension lists on
  // this side: Rust's binary sniff decides text vs "ask the OS".
  //   1. bounded text read → real text? render the text pane
  //   2. binary (null) → OS thumbnail (Quick Look on macOS, image crate for
  //      images; `null` on platforms without a generator)
  //   3. still nothing → "No preview available" caption
  // Raw bytes can never reach the pane: the #741 guard runs inside step 1.
  let previewText = $state<string | null>(null);
  let previewThumbUrl = $state<string | null>(null);
  let previewLoading = $state(false);
  let currentPreviewPath = $state('');
  // `FileHit` doesn't carry size/dates — the detail pane stats the one
  // selected file lazily instead of keeping it in the hot per-keystroke struct.
  let selectedMeta = $state<{
    path: string;
    size: number | null;
    created: Date | null;
    modified: Date | null;
    where: string;
  } | null>(null);

  const MAX_TEXT_PREVIEW = 50_000;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const item = selected;
    clearTimeout(previewTimer);
    if (item && !item.isDir) {
      // Debounced: holding an arrow key steps through many rows a second.
      // The thumbnail half of the chain spawns `qlmanage` for binaries —
      // without this, scrolling through 20 archive/video files fires 20
      // subprocess spawns for files the user only glanced at for a few
      // milliseconds each.
      previewTimer = setTimeout(() => void loadPreview(item.path), 150);
    } else {
      previewText = null;
      previewThumbUrl = null;
      previewLoading = false;
      currentPreviewPath = '';
    }

    if (item) void loadMeta(item.path);
    else selectedMeta = null;

    return () => clearTimeout(previewTimer);
  });

  async function loadPreview(path: string) {
    previewLoading = true;
    currentPreviewPath = path;
    // Clear BOTH render states before the awaits — otherwise a text file
    // followed by a binary one keeps rendering the old text (the text
    // branch is checked before the thumbnail branch), exactly what the
    // selection change was supposed to replace.
    previewText = null;
    previewThumbUrl = null;
    try {
      // Step 1 — bounded text read (via std::fs, not the webview fs scope;
      // binary-sniffed on the Rust side so raw bytes never reach the pane).
      const text = await readTextPreview(path, MAX_TEXT_PREVIEW);
      if (currentPreviewPath !== path) return; // superseded mid-flight
      if (text !== null && text.length > 0) {
        previewText = text;
        return;
      }

      // Step 2 — binary (or empty): ask the OS for a thumbnail.
      previewThumbUrl = await getFileThumbnail(path, DETAIL_THUMB_DIM);
      if (currentPreviewPath !== path) return; // superseded mid-flight
    } catch (err) {
      logService.warn(`[FileSearch] preview load failed: ${err}`);
    } finally {
      if (currentPreviewPath === path) previewLoading = false;
    }
  }

  async function loadMeta(path: string) {
    // Rust std::fs metadata: the webview fs plugin's `stat` is scope-limited
    // and dropped the creation date.
    const preview = await openerPathPreview(path).catch(() => null);
    if (selected?.path !== path) return; // superseded
    const date = (secs: number | null | undefined) => (secs ? new Date(secs * 1000) : null);
    selectedMeta = {
      path,
      size: preview?.size ?? null,
      created: date(preview?.created),
      modified: date(preview?.modified),
      where: preview?.parent ?? path,
    };
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
      await openerService.openPath(null, item.path);
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
    leftWidth={340}
    minLeftWidth={240}
    maxLeftWidth={600}
    ariaLabel="Files"
    emptyMessage={fileSearchViewState.searchQuery ? 'No matches' : 'Start typing to search…'}
  >
    {#snippet listHeader()}
      <div class="section-header">
        {fileSearchViewState.searchQuery.trim()
          ? t('features.file_search.ui.results')
          : t('common.pinned')}
      </div>
    {/snippet}

    {#snippet listItem(item: FileHit, index: number)}
      <LauncherListRow
        data-index={index}
        selected={selectedIndex === index}
        onclick={() => onSelect(item)}
        ondblclick={() => onActivate(item)}
        icon={iconOf(item)}
        titlePrefix={prefixOf(item)}
        title={item.name}
      >
        {#snippet trailing()}
          {#if item.source === 'deep'}
            <Badge text={t('features.file_search.ui.deep')} variant="default" mono />
          {:else if pinnedIds.has(item.fileId)}
            <svg
              class="pin-badge"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-label={t('common.pinned')}
            >
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
        <div class="detail-scroll custom-scrollbar">
          <div class="preview-card">
            {#if selected.isDir}
              <div class="image-pane">
                {#if isIconImage(iconOf(selected))}
                  <img src={iconOf(selected)} alt="" class="preview-icon" />
                {:else}
                  <!-- Linux has no native file icons: show the builtin glyph. -->
                  <Icon name={getBuiltInIconName(iconOf(selected))} size={64} />
                {/if}
              </div>
            {:else if previewLoading}
              <div class="text-caption opacity-50">
                {t('features.file_search.ui.loading_preview')}
              </div>
            {:else if previewText}
              <pre class="text-preview">{previewText}</pre>
            {:else if previewThumbUrl}
              <div class="image-pane">
                <img src={previewThumbUrl} alt="" class="preview-image" />
              </div>
            {:else}
              <div class="image-pane">
                {#if isIconImage(iconOf(selected))}
                  <img src={iconOf(selected)} alt="" class="preview-icon" />
                {:else}
                  <!-- Linux has no native file icons: show the builtin glyph. -->
                  <Icon name={getBuiltInIconName(iconOf(selected))} size={64} />
                {/if}
              </div>
            {/if}
          </div>

          <div class="section-header">{t('features.file_search.ui.metadata')}</div>
          <dl class="meta-list">
            <div class="meta-row">
              <dt>{t('features.file_search.ui.name')}</dt>
              <dd>{selected.name}</dd>
            </div>
            <div class="meta-row">
              <dt>{t('features.file_search.ui.where')}</dt>
              <dd title={selected.path}>
                {selectedMeta?.path === selected.path ? selectedMeta.where : '…'}
              </dd>
            </div>
            <div class="meta-row">
              <dt>{t('features.file_search.ui.type')}</dt>
              <dd>{kindOf(selected)}</dd>
            </div>
            {#if selectedMeta?.path === selected.path && selectedMeta.size !== null}
              <div class="meta-row">
                <dt>{t('features.file_search.ui.size')}</dt>
                <dd>{formatBytes(selectedMeta.size)}</dd>
              </div>
            {/if}
            <div class="meta-row">
              <dt>{t('features.file_search.ui.created')}</dt>
              <dd>
                {formatDate(selectedMeta?.path === selected.path ? selectedMeta.created : null)}
              </dd>
            </div>
            <div class="meta-row">
              <dt>{t('features.file_search.ui.modified')}</dt>
              <dd>{formatDate(new Date(selected.modifiedAt * 1000))}</dd>
            </div>
          </dl>
        </div>
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

  .detail-scroll {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-4);
    contain: layout paint;
    min-width: 0;
  }

  .preview-card {
    height: 280px;
    overflow: hidden;
    padding: var(--space-4) var(--space-5);
    border-radius: var(--radius-lg);
    background: var(--bg-secondary);
    margin-bottom: var(--space-3);
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
  }

  /* Natural size up to 128px: macOS icons are 128px, Windows shell icons
     only 32px — upscaling those would blur them. */
  .preview-icon {
    max-width: 128px;
    max-height: 128px;
    object-fit: contain;
  }

  .text-preview {
    font-family: var(--font-mono);
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    font-size: var(--font-size-sm);
    line-height: 1.6;
    margin: 0;
  }

  .meta-list {
    margin: 0;
  }

  .meta-row {
    display: flex;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
  }

  .meta-row:nth-child(odd) {
    background: var(--bg-secondary);
  }

  .meta-row dt {
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .meta-row dd {
    margin: 0;
    color: var(--text-primary);
    text-align: right;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
