<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import {
    clipboardViewState,
    onViewActivated,
    onSearchChanged,
    onScrolledToEnd,
    fetchFullItemForId,
    visibleItems,
  } from './state.svelte';
  import { clipboardHistoryStore } from '../../services/clipboard/stores/clipboardHistoryStore.svelte';
  import { fetchRawHtml } from './urlFetcher';
  import {
    parseFilePaths,
    fileNameOf,
    loadFileThumbnails,
    FILE_THUMB_DIM,
    IMAGE_EXT_RE,
  } from './filePreview';
  import { stripRtf, type ClipboardHistoryItem } from 'asyar-sdk/contracts';
  import type { StoredClipboardItem } from '../../lib/ipc/commands';
  import { readFile } from '@tauri-apps/plugin-fs';
  import { revealItemInDir } from '@tauri-apps/plugin-opener';
  import { openerService } from '../../services/opener/openerService';
  import { getHostPlatform } from '../../lib/keyboard/hostPlatform';
  import { renderMarkdown, handleMarkdownCopyClick } from '../../utils/markdown';
  import { renderMermaidDiagrams } from '../../utils/mermaid';
  import {
    SplitListDetail,
    EmptyState,
    LauncherListRow,
    Badge,
    Icon,
    IconButton,
    MetadataList,
  } from '../../components';
  import { searchBarAccessoryService } from '../../services/search/searchBarAccessoryService.svelte';
  import { searchStores } from '../../services/search/stores/search.svelte';
  import {
    applyDropdownSelectionToQuery,
    buildClipboardAccessoryState,
    parseClipboardSearchQuery,
  } from './queryFilterParser';
  import { getItemDisplay, highlightInElement } from './snippetHighlight';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { logService } from '../../services/log/logService';
  import { t } from '../../services/i18n';
  import { appListen } from '../../lib/ipc/bridgeEvents';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import { actionService } from '../../services/action/actionService.svelte';

  const detailDateFormat = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });

  const relativeTimeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  function formatRelativeTime(ms: number): string {
    const diffSeconds = Math.round((ms - Date.now()) / 1000);
    const abs = Math.abs(diffSeconds);
    if (abs < 60) return 'just now';
    if (abs < 3600) return relativeTimeFormat.format(Math.round(diffSeconds / 60), 'minute');
    if (abs < 86400) return relativeTimeFormat.format(Math.round(diffSeconds / 3600), 'hour');
    return relativeTimeFormat.format(Math.round(diffSeconds / 86400), 'day');
  }

  function timeSection(timestamp: number): string {
    const d = new Date(timestamp);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const itemDay = new Date(d);
    itemDay.setHours(0, 0, 0, 0);
    const diffDays = Math.round((today.getTime() - itemDay.getTime()) / 86400000);
    if (diffDays <= 0) return t('features.clipboard.time_today');
    if (diffDays === 1) return t('features.clipboard.time_yesterday');
    if (diffDays < 7) return t('features.clipboard.time_this_week');
    if (d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear())
      return t('features.clipboard.time_this_month');
    return t('features.clipboard.time_older');
  }

  function formatDetailDate(timestamp: number): string {
    return detailDateFormat.format(timestamp);
  }

  // Image loading state
  let imageLoading = $state(false);
  let imageUrl = $state('');
  let currentImagePath = $state('');

  // Thumbnails for `files` entries. macOS screenshot tools (and Finder)
  // put a *file reference* on the pasteboard rather than image data, and
  // handleClipboardChange prefers files over image — so a copied screenshot
  // arrives here as type `files` and used to render as a bare filename row.
  let fileThumbnails = $state<Record<string, string | null>>({});
  let currentFilesContent = $state('');

  // URL content fetch state
  let urlBlobUrl = $state('');
  let urlLoading = $state(false);
  let urlFetchFailed = $state(false);
  let currentFetchedUrl = $state('');

  let detailEl = $state<HTMLElement | null>(null);
  let listWrapperEl = $state<HTMLElement | null>(null);

  interface PreviewContextMenuState {
    x: number;
    y: number;
    path: string;
    isImage: boolean;
  }

  let previewContextMenu = $state<PreviewContextMenuState | null>(null);
  let contextMenuEl = $state<HTMLElement | null>(null);

  let showRenderedHtml = $derived(clipboardViewState.showRenderedHtml);

  $effect(() => clipboardViewState.subscribeToHistoryChanges());

  // Mirror the store's currently-visible window (searchResults ?? favorites
  // + recent) into clipboardViewState.items so the existing filteredItems
  // derivation and the keyboard handler in index.ts always see the same
  // data as the rendered list.
  $effect(() => {
    const store = clipboardHistoryStore;
    const next = store.searchResults ?? [...store.favorites, ...store.recent];
    clipboardViewState.items = next as unknown as ClipboardHistoryItem[];
  });

  // SINGLE source of truth: clipboardViewState.filteredItems (the local
  // store-mirrored items plus type filter). The keyboard handler in
  // index.ts also reads from this, so the rendered list and arrow-key
  // navigation now operate on the exact same array.
  let items = $derived(clipboardViewState.filteredItems);
  let selectedId = $derived(clipboardViewState.selectedItemId);
  let selectedIndex = $derived(items.findIndex((i) => i.id === selectedId));
  let favoritesCount = $derived(items.filter((i) => i.favorite).length);

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
    if (!list.some((i) => i.id === selectedId)) {
      clipboardViewState.selectedItemId = list[0].id;
    }
  });

  // Full item fetched lazily when selection changes. Rust decrypts the stored
  // content; secret-tagged rows remain masked by the detail renderer below.
  let selectedFullItem = $state<StoredClipboardItem | null>(null);
  $effect(() => {
    const id = clipboardViewState.selectedItemId;
    previewContextMenu = null;
    if (!id) {
      selectedFullItem = null;
      clipboardViewState.selectedFullItem = null;
      return;
    }
    void fetchFullItemForId(id)
      .then((full) => {
        if (clipboardViewState.selectedItemId === id) {
          selectedFullItem = full;
          clipboardViewState.selectedFullItem = full;
        }
      })
      .catch((err) => {
        feedbackService.report({
          source: 'frontend',
          kind: 'clipboard/get-item-failed',
          severity: 'error',
          retryable: false,
          developerDetail: String(err),
        });
      });
  });

  // Keep the searchbar accessory dropdown (options, checkmarks, and
  // summary label) synchronized with the search query and known source
  // apps without triggering persistence writes or broadcast feedback loops.
  let lastFilterKey = '';
  $effect(() => {
    const parsed = clipboardViewState.parsedQuery;
    const sourceApps = clipboardHistoryStore.sourceApps ?? [];
    // Only rebuild/sync the accessory when filters or source apps actually change,
    // not on every plain text search keystroke.
    const filterKey = `${parsed.typeFilter}|${parsed.appFilter ?? ''}|${parsed.dateFilter ?? ''}|${sourceApps.length}`;
    if (filterKey === lastFilterKey) return;
    lastFilterKey = filterKey;
    const acc = buildClipboardAccessoryState(parsed, sourceApps, t);
    searchBarAccessoryService.syncViewState?.({
      extensionId: 'clipboard-history',
      commandId: 'show-clipboard',
      options: acc.options,
      value: parsed.typeFilter,
      buttonTitle: acc.buttonTitle,
    });
  });

  // Subscribe to user selections in the searchbar-accessory dropdown and
  // reflect them as structured tokens (`type:`, `app:`, `date:`) inside the
  // main search bar so users both see and can type the same filters.
  $effect(() => {
    let ready = false;
    const off = searchBarAccessoryService.subscribe(
      'clipboard-history',
      'show-clipboard',
      (value) => {
        if (!ready) return;
        const nextQuery = applyDropdownSelectionToQuery(clipboardViewState.searchQuery, value);
        const parsedNext = parseClipboardSearchQuery(nextQuery);
        clipboardViewState.setTypeFilter(parsedNext.typeFilter);
        clipboardViewState.setSearch(nextQuery);
        searchStores.query = nextQuery;
        void tick().then(() => {
          const input = document.querySelector<HTMLInputElement>('.search-input-clean');
          if (input) {
            input.focus();
            input.setSelectionRange(nextQuery.length, nextQuery.length);
          }
        });
      },
    );
    ready = true;
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
  $effect(() => {
    void onViewActivated();
  });

  // Mirror the search query into the store's search so FTS is used.
  // Debounced: typing quickly coalesces into a single backend search
  // after the user pauses for 40ms, avoiding queuing multiple expensive
  // FTS matches and decryptions across intermediate keystrokes.
  // In-flight searches from previous keystrokes are immediately dropped
  // via cancelPendingSearch so stale results never flash or stutter the UI.
  let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const q = clipboardViewState.searchQuery;
    clearTimeout(searchDebounceTimer);
    clipboardHistoryStore.cancelPendingSearch?.();
    if (!q.trim()) {
      void onSearchChanged(q);
      return;
    }
    searchDebounceTimer = setTimeout(() => {
      void onSearchChanged(q);
    }, 40);
    return () => clearTimeout(searchDebounceTimer);
  });

  // Re-run the current search when the FTS index becomes ready.
  $effect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        unlisten = await appListen('clipboard:fts-ready', () => {
          clipboardHistoryStore.indexState = 'ready';
          const q = clipboardViewState.searchQuery.trim();
          if (q) void onSearchChanged(q);
        });
      } catch (err) {
        feedbackService.report({
          source: 'frontend',
          kind: 'clipboard/fts-listener-failed',
          severity: 'error',
          retryable: false,
          developerDetail: String(err),
        });
      }
    })();
    return () => {
      unlisten?.();
    };
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

  function highlightPreview(query: string) {
    for (const preview of Array.from(
      detailEl?.querySelectorAll<HTMLElement>('.source-preview, .html-preview, .md-content') ?? [],
    )) {
      highlightInElement(preview, query);
    }
  }

  // Highlight search terms in the detail body preview
  let lastHighlightedItem: string | null = null;
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const item = selectedFullItem;
    const _rendered = showRenderedHtml;
    const query = clipboardViewState.searchQuery;
    const itemId = item?.id ?? null;

    let cancelled = false;
    clearTimeout(highlightTimer);
    if (!detailEl) return;

    if (!query.trim()) {
      highlightPreview('');
      lastHighlightedItem = itemId;
      return;
    }

    // When a newly selected clip loads, highlight its terms immediately.
    // When only the search query is changing while viewing the same clip,
    // debounce so rapid keystrokes don't repeatedly traverse/mutate the DOM.
    const isNewItem = itemId !== lastHighlightedItem;
    if (isNewItem) {
      lastHighlightedItem = itemId;
      tick().then(() => {
        if (!cancelled && detailEl) highlightPreview(query);
      });
    } else {
      highlightTimer = setTimeout(() => {
        if (!cancelled && detailEl) highlightPreview(query);
      }, 40);
    }

    return () => {
      cancelled = true;
      clearTimeout(highlightTimer);
    };
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

  // Load thumbnails when a files item is selected. Debounced because
  // holding an arrow key steps through many rows a second, and on macOS
  // every non-image type is thumbnailed via a `qlmanage` subprocess.
  let fileThumbTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const item = selectedFullItem;

    if (!item || item.type !== 'files' || item.redactedKinds?.length) {
      clearTimeout(fileThumbTimer);
      fileThumbnails = {};
      currentFilesContent = '';
      return;
    }

    const content = item.content ?? '';
    // Already loaded, or a load is already pending, for this exact entry.
    // Cancelling the timer here would drop a request no later run reschedules.
    if (content === currentFilesContent) return;

    clearTimeout(fileThumbTimer);
    currentFilesContent = content;
    fileThumbnails = {};
    const paths = parseFilePaths(content);
    if (paths.length === 0) return;

    fileThumbTimer = setTimeout(() => {
      void loadFileThumbnails(paths, FILE_THUMB_DIM).then((thumbs) => {
        // Selection may have moved on while the thumbnails were generating.
        if (currentFilesContent === content) fileThumbnails = thumbs;
      });
    }, 150);
  });

  $effect(() => {
    if (!previewContextMenu) return;

    const unregisterEscape = viewManager.registerEscapeInterceptor(() => {
      if (!previewContextMenu) return false;
      previewContextMenu = null;
      return true;
    });

    let unlistenResignKey: (() => void) | null = null;
    let cancelled = false;
    void appListen('main_panel_did_resign_key', () => {
      previewContextMenu = null;
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlistenResignKey = fn;
      })
      .catch(() => {});

    const handlePointerDown = (e: Event) => {
      if (contextMenuEl && e.target instanceof Node && !contextMenuEl.contains(e.target)) {
        previewContextMenu = null;
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        previewContextMenu = null;
      }
    };
    const dismiss = () => {
      previewContextMenu = null;
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('blur', dismiss);
    return () => {
      cancelled = true;
      unlistenResignKey?.();
      unregisterEscape();
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('blur', dismiss);
    };
  });

  onDestroy(() => {
    clearTimeout(fileThumbTimer);
    previewContextMenu = null;
    // Blob URLs keep their data alive until revoked. Clearing the current
    // path/url also makes any load still in flight drop its result.
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    if (urlBlobUrl) URL.revokeObjectURL(urlBlobUrl);
    currentImagePath = '';
    currentFetchedUrl = '';
    fileThumbnails = {};
    currentFilesContent = '';
  });

  // Fetch URL content when a URL item is selected
  $effect(() => {
    const item = selectedFullItem;
    if (!item || item.redactedKinds?.length || !isUrl(item.content) || !showRenderedHtml) {
      if (currentFetchedUrl) {
        if (urlBlobUrl) {
          URL.revokeObjectURL(urlBlobUrl);
          urlBlobUrl = '';
        }
        urlLoading = false;
        urlFetchFailed = false;
        currentFetchedUrl = '';
      }
      return;
    }
    const url = item.content!.trim();
    if (url === currentFetchedUrl) return;

    // Revoke previous blob URL
    if (urlBlobUrl) {
      URL.revokeObjectURL(urlBlobUrl);
      urlBlobUrl = '';
    }

    currentFetchedUrl = url;
    urlFetchFailed = false;
    urlLoading = true;

    const network = clipboardViewState.networkService;
    if (!network) {
      urlLoading = false;
      urlFetchFailed = true;
      return;
    }

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
      // Selection may have moved on while the file was being read.
      if (currentImagePath !== path) return;
      const blob = new Blob([data], { type: 'image/png' });
      // Revoke previous URL
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = URL.createObjectURL(blob);
    } catch (e) {
      if (currentImagePath !== path) return;
      logService.warn(`[ClipboardHistory] Failed to load image: ${e}`);
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = '';
    } finally {
      if (currentImagePath === path) imageLoading = false;
    }
  }

  function selectItem(id: string) {
    clipboardViewState.selectedItemId = id;
  }

  function handleRowClick(e: MouseEvent, id: string) {
    if (e.metaKey || e.ctrlKey) {
      clipboardViewState.toggleMultiSelect(id);
    } else {
      selectItem(id);
    }
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
      feedbackService.report({
        source: 'frontend',
        kind: 'clipboard/paste-failed',
        severity: 'error',
        retryable: false,
        developerDetail: String(err),
      });
    }
  }

  function getItemTitle(item: { type: string; preview?: string; customTitle?: string }) {
    if (item.customTitle?.trim()) {
      return item.customTitle.trim();
    }
    const preview = item.preview ?? '';
    if (!preview)
      return item.type === 'image' ? 'Image' : item.type === 'files' ? 'Files' : 'Empty';
    return preview.substring(0, 200).replace(/\n/g, ' ').trim() || 'Empty';
  }

  function sanitizeHtml(html: string): string {
    const raw = html.length > MAX_PREVIEW_CHARS ? html.substring(0, MAX_PREVIEW_CHARS) : html;
    if (!raw) return '';

    let out = '';
    let i = 0;
    const len = raw.length;

    while (i < len) {
      // Strip script and style blocks
      const lower = raw.slice(i, i + 8).toLowerCase();
      if (lower.startsWith('<script')) {
        const endIdx = raw.toLowerCase().indexOf('</' + 'script', i);
        if (endIdx === -1) break;
        const closeIdx = raw.indexOf('>', endIdx);
        if (closeIdx === -1) break;
        i = closeIdx + 1;
        continue;
      }
      if (lower.startsWith('<style')) {
        const endIdx = raw.toLowerCase().indexOf('</' + 'style', i);
        if (endIdx === -1) break;
        const closeIdx = raw.indexOf('>', endIdx);
        if (closeIdx === -1) break;
        i = closeIdx + 1;
        continue;
      }

      if (raw[i] === '<') {
        const tagEnd = raw.indexOf('>', i);
        if (tagEnd === -1) {
          out += raw.slice(i);
          break;
        }
        const tagContent = raw.slice(i, tagEnd + 1);
        let cleanTag = '';
        const spaceIdx = tagContent.search(/[\s>]/);
        const tagName = spaceIdx === -1 ? tagContent : tagContent.slice(0, spaceIdx);
        cleanTag += tagName;

        let j = tagName.length;
        while (j < tagContent.length) {
          const c = tagContent[j];
          if (c === '>') {
            cleanTag += '>';
            break;
          }
          if (/\s/.test(c)) {
            cleanTag += c;
            j++;
            continue;
          }
          const attrNameStart = j;
          while (j < tagContent.length && !/[\s=>]/.test(tagContent[j])) {
            j++;
          }
          const attrName = tagContent.slice(attrNameStart, j);
          let attrValue = '';
          while (j < tagContent.length && /\s/.test(tagContent[j])) {
            j++;
          }
          if (tagContent[j] === '=') {
            j++;
            while (j < tagContent.length && /\s/.test(tagContent[j])) {
              j++;
            }
            if (tagContent[j] === '"' || tagContent[j] === "'") {
              const quote = tagContent[j];
              j++;
              const valStart = j;
              while (j < tagContent.length && tagContent[j] !== quote) {
                j++;
              }
              attrValue = quote + tagContent.slice(valStart, j) + quote;
              if (j < tagContent.length) j++;
            } else {
              const valStart = j;
              while (j < tagContent.length && !/[\s>]/.test(tagContent[j])) {
                j++;
              }
              attrValue = tagContent.slice(valStart, j);
            }
          }

          const isDangerous =
            attrName.toLowerCase().startsWith('on') ||
            ((attrName.toLowerCase() === 'href' || attrName.toLowerCase() === 'src') &&
              attrValue.toLowerCase().includes('javascript:'));

          if (!isDangerous) {
            cleanTag += attrName + (attrValue ? '=' + attrValue : '');
          } else if (cleanTag.endsWith(' ')) {
            cleanTag = cleanTag.slice(0, -1);
          }
        }

        out += cleanTag;
        i = tagEnd + 1;
      } else {
        out += raw[i];
        i++;
      }
    }

    return out;
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
      feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: t('features.clipboard.ui.reveal_failed', { path }) },
      });
    }
  }

  async function openPreviewFile(path: string, withPreview: boolean) {
    try {
      const options =
        withPreview && getHostPlatform() === 'macos' ? { with: 'Preview' } : undefined;
      await openerService.openPath(null, path, options);
    } catch (error) {
      logService.error(`Failed to open file ${path}: ${String(error)}`);
      void feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: t('features.clipboard.ui.open_failed', { path }) },
      });
    }
  }

  function getOpenMenuLabel(isImage: boolean): string {
    if (!isImage) return t('actions.open');
    return getHostPlatform() === 'macos'
      ? t('features.clipboard.ui.open_in_preview')
      : t('features.clipboard.ui.open_image');
  }

  function getRevealMenuLabel(): string {
    const platform = getHostPlatform();
    if (platform === 'macos') return t('features.clipboard.ui.reveal_title');
    if (platform === 'windows') return t('core_actions.reveal_app_win');
    return t('core_actions.reveal_app');
  }

  async function openPreviewContextMenu(
    e: MouseEvent,
    item: StoredClipboardItem | null,
    path: string,
    isImage: boolean,
  ) {
    e.preventDefault();
    e.stopPropagation();
    if (!item || !path || path.startsWith('data:')) {
      previewContextMenu = null;
      return;
    }
    previewContextMenu = { x: e.clientX, y: e.clientY, path, isImage };
    await tick();
    if (!contextMenuEl || !previewContextMenu) return;
    const rect = contextMenuEl.getBoundingClientRect();
    const pad = 8;
    const clampedX = Math.max(pad, Math.min(e.clientX, window.innerWidth - rect.width - pad));
    const clampedY = Math.max(pad, Math.min(e.clientY, window.innerHeight - rect.height - pad));
    if (clampedX !== previewContextMenu.x || clampedY !== previewContextMenu.y) {
      previewContextMenu = { ...previewContextMenu, x: clampedX, y: clampedY };
    }
    contextMenuEl.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }

  async function handleContextOpen() {
    const menu = previewContextMenu;
    if (!menu) return;
    previewContextMenu = null;
    await clipboardViewState.openPreviewFile(menu.path, menu.isImage);
  }

  async function handleContextReveal() {
    const menu = previewContextMenu;
    if (!menu) return;
    previewContextMenu = null;
    await clipboardViewState.revealFile(menu.path);
  }

  async function handleContextCopyText() {
    const menu = previewContextMenu;
    if (!menu) return;
    previewContextMenu = null;
    await clipboardViewState.copyTextFromImage({ content: menu.path } as any);
  }

  function handleContextMenuKeydown(e: KeyboardEvent) {
    if (!contextMenuEl) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const items = Array.from(contextMenuEl.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    let nextIndex = 0;
    if (e.key === 'ArrowDown') {
      nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % items.length;
    } else if (e.key === 'ArrowUp') {
      nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
    } else if (e.key === 'End') {
      nextIndex = items.length - 1;
    }
    items[nextIndex]?.focus();
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
    return text
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0).length;
  }

  function getMetadataText(item: {
    type: string;
    content?: string;
    metadata?: Record<string, unknown>;
  }): string {
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
      const count = meta.fileCount as number;
      const parts = [`${count} file${count !== 1 ? 's' : ''}`];
      if (meta.sizeBytes) parts.push(formatBytes(meta.sizeBytes as number));
      return parts.join(' · ');
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
    <div class="indexing-hint">{t('features.clipboard.ui.indexing')}</div>
  {/if}
  <div class="split-list-wrapper" bind:this={listWrapperEl}>
    <SplitListDetail
      {items}
      {selectedIndex}
      leftWidth={260}
      minLeftWidth={200}
      maxLeftWidth={600}
      ariaLabel="Clipboard Items"
      emptyMessage={t('search.no_results')}
    >
      {#snippet listItem(item, index)}
        {#if index === 0 && favoritesCount > 0}
          <div class="list-section">{t('common.pinned')}</div>
        {/if}
        {@const isFirstNonFavorite = index === favoritesCount && index < items.length}
        {@const prevItem = index > favoritesCount ? items[index - 1] : null}
        {@const sectionLabel = !item.favorite ? timeSection(item.createdAt) : null}
        {@const showDayHeader =
          !item.favorite &&
          (isFirstNonFavorite || (prevItem && timeSection(prevItem.createdAt) !== sectionLabel))}
        {#if showDayHeader && sectionLabel}
          <div class="list-section">{sectionLabel}</div>
        {/if}
        {@const display = getItemDisplay(item, clipboardViewState.searchQuery)}
        <LauncherListRow
          data-index={index}
          selected={selectedIndex === index}
          multiSelected={clipboardViewState.isMultiSelected(item.id)}
          onclick={(e: MouseEvent) => handleRowClick(e, item.id)}
          ondblclick={() => pasteItemById(item.id)}
          title={display.title}
          titleChunks={display.titleChunks}
          subtitle={display.subtitle}
        >
          {#snippet leading()}
            {#if clipboardViewState.isMultiSelected(item.id)}
              <div class="multi-select-checkmark">
                <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  ><path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="3"
                    d="M5 13l4 4L19 7"
                  /></svg
                >
              </div>
            {/if}
            {#if item.type === 'image'}
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"
                ><path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                /></svg
              >
            {:else if item.type === 'files'}
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"
                ><path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                /></svg
              >
            {:else if item.type === 'html'}
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"
                ><path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                /></svg
              >
            {:else if item.type === 'rtf'}
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"
                ><path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                /></svg
              >
            {:else}
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"
                ><path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 6h16M4 12h16M4 18h7"
                /></svg
              >
            {/if}
          {/snippet}
          {#snippet trailing()}
            {#if item.favorite}
              <span
                class="pin-badge flex items-center justify-center opacity-70 flex-shrink-0"
                aria-label={t('common.pinned')}
                data-testid="clip-pin-icon"
              >
                <Icon name="pin" size={13} />
              </span>
            {/if}
          {/snippet}
        </LauncherListRow>
      {/snippet}

      {#snippet detail()}
        {#if selectedId}
          {#if !selectedFullItem?.redactedKinds?.length && showRenderedHtml && isUrl(selectedFullItem?.content) && urlBlobUrl}
            <iframe
              src={urlBlobUrl}
              class="url-iframe"
              sandbox="allow-scripts"
              title={t('features.clipboard.ui.url_preview')}
            ></iframe>
          {:else}
            <div class="clip-detail-content custom-scrollbar" bind:this={detailEl}>
              {#if !selectedFullItem}
                <span style="color: var(--text-tertiary)">{t('common.loading_ellipsis')}</span>
              {:else if !selectedFullItem.content}
                <span style="color: var(--text-tertiary)"
                  >{t('features.clipboard.ui.no_preview')}</span
                >
              {:else if selectedFullItem.redactedKinds?.length}
                <div class="flex items-center gap-3 p-6">
                  <Badge text={t('features.clipboard.ui.encrypted_secret')} variant="warning" />
                  <span class="text-caption">{t('features.clipboard.ui.paste_original')}</span>
                </div>
              {:else if selectedFullItem.type === 'image'}
                <div
                  class="image-container w-full h-full flex flex-col items-center justify-center p-4"
                >
                  {#if imageLoading}
                    <div class="text-caption opacity-50">
                      {t('features.clipboard.ui.loading_image')}
                    </div>
                  {:else if imageUrl}
                    <img
                      src={imageUrl}
                      class="max-w-full max-h-full object-contain rounded-md shadow-sm border"
                      style="border-color: var(--border-color);"
                      alt={t('features.clipboard.ui.preview_alt')}
                      oncontextmenu={(e) =>
                        openPreviewContextMenu(
                          e,
                          selectedFullItem,
                          selectedFullItem?.content ?? '',
                          true,
                        )}
                    />
                  {:else}
                    <div class="text-caption opacity-50">
                      {t('features.clipboard.ui.image_failed')}
                    </div>
                  {/if}
                  {#if selectedFullItem.metadata && (selectedFullItem.metadata.width || selectedFullItem.metadata.sizeBytes)}
                    <div class="mt-3 text-caption opacity-70 flex items-center gap-3">
                      {#if selectedFullItem.metadata.width && selectedFullItem.metadata.height}
                        <span
                          >{selectedFullItem.metadata.width} × {selectedFullItem.metadata
                            .height}</span
                        >
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
                  <pre class="source-preview">{@html getSourcePreview(
                      selectedFullItem.content,
                    )}</pre>
                  {#if isContentTruncated(selectedFullItem.content)}
                    <div class="truncation-notice">
                      Showing first {MAX_PREVIEW_CHARS.toLocaleString()} of {selectedFullItem.content.length.toLocaleString()}
                      characters
                    </div>
                  {/if}
                {/if}
              {:else if selectedFullItem.type === 'rtf'}
                {#if showRenderedHtml}
                  <pre class="source-preview">{@html escapeHtml(
                      stripRtf(selectedFullItem.content),
                    )}</pre>
                {:else}
                  <pre class="source-preview">{@html getSourcePreview(
                      selectedFullItem.content,
                    )}</pre>
                {/if}
                {#if isContentTruncated(selectedFullItem.content)}
                  <div class="truncation-notice">
                    Showing first {MAX_PREVIEW_CHARS.toLocaleString()} of {selectedFullItem.content.length.toLocaleString()}
                    characters
                  </div>
                {/if}
              {:else if selectedFullItem.type === 'files'}
                {@const filePaths = parseFilePaths(selectedFullItem.content)}
                {@const soloThumb =
                  filePaths.length === 1 ? (fileThumbnails[filePaths[0]] ?? null) : null}
                <div class="flex flex-col gap-1.5 p-4">
                  {#if soloThumb}
                    <!-- A single copied file that the backend can thumbnail —
                         a screenshot, in the case that motivated this. Show it
                         the way an `image` entry is shown rather than as a
                         one-row filename list. -->
                    <div class="flex items-center justify-center pb-3">
                      <img
                        src={soloThumb}
                        class="max-w-full object-contain rounded-md shadow-sm border file-solo-thumb"
                        style="border-color: var(--border-color);"
                        alt="Preview of {fileNameOf(filePaths[0])}"
                        oncontextmenu={(e) =>
                          openPreviewContextMenu(
                            e,
                            selectedFullItem,
                            filePaths[0],
                            IMAGE_EXT_RE.test(filePaths[0]),
                          )}
                      />
                    </div>
                  {/if}
                  {#each filePaths as filePath}
                    <div
                      class="flex items-center gap-2 py-1.5 px-2 rounded"
                      style="background: var(--bg-secondary);"
                    >
                      {#if !soloThumb && fileThumbnails[filePath]}
                        <img
                          src={fileThumbnails[filePath]}
                          class="file-row-thumb flex-shrink-0"
                          alt=""
                          aria-hidden="true"
                          oncontextmenu={(e) => e.preventDefault()}
                        />
                      {:else}
                        <svg
                          class="w-4 h-4 flex-shrink-0 opacity-60"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                          /></svg
                        >
                      {/if}
                      <span
                        class="text-sm truncate flex-1"
                        style="color: var(--text-primary); font-family: var(--font-mono);"
                        >{fileNameOf(filePath)}</span
                      >
                      <IconButton
                        onclick={() => revealFile(filePath)}
                        title={t('features.clipboard.ui.reveal_title')}
                        ariaLabel="Reveal in Finder"
                      >
                        <svg
                          class="w-3.5 h-3.5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                          /></svg
                        >
                      </IconButton>
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
                      <svg
                        class="w-10 h-10 opacity-40"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        ><path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="1.5"
                          d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                        /></svg
                      >
                    </div>
                    <div class="url-domain">{getUrlDomain(selectedFullItem.content)}</div>
                    <div class="url-full">{selectedFullItem.content.trim()}</div>
                    {#if urlFetchFailed}
                      <div class="url-fetch-notice">
                        {t('features.clipboard.ui.preview_unavailable')}
                      </div>
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
                    <div class="truncation-notice">
                      Showing first {MAX_PREVIEW_CHARS.toLocaleString()} of {selectedFullItem.content.length.toLocaleString()}
                      characters
                    </div>
                  {/if}
                {:else}
                  <pre class="source-preview">{@html getSourcePreview(
                      selectedFullItem.content,
                    )}</pre>
                  {#if isContentTruncated(selectedFullItem.content)}
                    <div class="truncation-notice">
                      Showing first {MAX_PREVIEW_CHARS.toLocaleString()} of {selectedFullItem.content.length.toLocaleString()}
                      characters
                    </div>
                  {/if}
                {/if}
              {/if}
            </div>
          {/if}

          {#if clipboardViewState.selectedIds.length > 1}
            <div class="p-4 text-caption text-center" style="color: var(--text-secondary)">
              {clipboardViewState.selectedIds.length} items selected · Enter to merge &amp; paste
            </div>
          {:else if selectedFullItem}
            {@const customTitle =
              clipboardViewState.selectedItem?.customTitle ?? selectedFullItem.customTitle}
            <MetadataList
              title={t('common.information')}
              items={[
                ...(customTitle
                  ? [
                      {
                        label: t('features.clipboard.ui.custom_title'),
                        value: customTitle,
                      },
                    ]
                  : []),
                {
                  label: t('features.clipboard.ui.source'),
                  value: (selectedFullItem.sourceApp as any)?.name,
                  title: (selectedFullItem.sourceApp as any)?.windowTitle,
                  icon: (selectedFullItem.sourceApp as any)?.iconUrl,
                },
                {
                  label: t('features.clipboard.ui.type'),
                  value: selectedFullItem.type,
                },
                {
                  label: t('features.clipboard.ui.dimensions'),
                  value:
                    selectedFullItem.type === 'image' &&
                    selectedFullItem.metadata?.width &&
                    selectedFullItem.metadata?.height
                      ? `${selectedFullItem.metadata.width} × ${selectedFullItem.metadata.height}`
                      : null,
                },
                {
                  label: t('features.clipboard.ui.size'),
                  value: selectedFullItem.metadata?.sizeBytes
                    ? formatBytes(selectedFullItem.metadata.sizeBytes as number)
                    : null,
                },
                {
                  label: t('features.clipboard.ui.characters'),
                  value:
                    selectedFullItem.content &&
                    ['text', 'html', 'rtf'].includes(selectedFullItem.type)
                      ? selectedFullItem.content.length.toLocaleString()
                      : null,
                },
                {
                  label: t('features.clipboard.ui.words'),
                  value:
                    selectedFullItem.content &&
                    ['text', 'html', 'rtf'].includes(selectedFullItem.type)
                      ? getWordCount(selectedFullItem).toLocaleString()
                      : null,
                },
                {
                  label: t('features.clipboard.ui.copied'),
                  value: formatRelativeTime(selectedFullItem.createdAt),
                  title: formatDetailDate(selectedFullItem.createdAt),
                },
              ]}
            />
          {/if}
        {:else}
          <EmptyState message={t('features.clipboard.select_item_hint')}>
            {#snippet icon()}
              <svg
                class="w-16 h-16 opacity-30"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
            {/snippet}
          </EmptyState>
        {/if}
      {/snippet}
    </SplitListDetail>
  </div>
  {#if previewContextMenu}
    <div
      bind:this={contextMenuEl}
      class="preview-context-menu launcher-popup"
      data-no-focus-steal
      role="menu"
      tabindex="-1"
      aria-label={t('actions.title')}
      style="top: {previewContextMenu.y}px; left: {previewContextMenu.x}px;"
      onkeydown={handleContextMenuKeydown}
      oncontextmenu={(e) => e.preventDefault()}
    >
      <button type="button" class="context-menu-item" role="menuitem" onclick={handleContextOpen}>
        <svg
          class="w-3.5 h-3.5 flex-shrink-0 context-menu-icon"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          ><path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          /></svg
        >
        <span>{getOpenMenuLabel(previewContextMenu.isImage)}</span>
      </button>
      <button type="button" class="context-menu-item" role="menuitem" onclick={handleContextReveal}>
        <svg
          class="w-3.5 h-3.5 flex-shrink-0 context-menu-icon"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          ><path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          /></svg
        >
        <span>{getRevealMenuLabel()}</span>
      </button>
      {#if previewContextMenu.isImage}
        <button
          type="button"
          class="context-menu-item"
          role="menuitem"
          onclick={handleContextCopyText}
        >
          <svg
            class="w-3.5 h-3.5 flex-shrink-0 context-menu-icon"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            ><path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
            /><path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
            /></svg
          >
          <span>{t('features.clipboard.ui.copy_text_from_image')}</span>
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .view-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .multi-select-checkmark {
    position: absolute;
    top: -3px;
    left: -3px;
    width: 12px;
    height: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--accent-primary-fill);
    color: var(--text-on-accent);
    z-index: var(--z-base);
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
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(350%);
    }
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
    0%,
    100% {
      opacity: 0.4;
    }
    50% {
      opacity: 0.8;
    }
  }

  .url-iframe {
    flex: 1;
    width: 100%;
    height: 100%;
    border: none;
    background: var(--surface-canvas);
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

  :global(.html-preview mark.search-match),
  :global(.html-preview .search-match) {
    color: var(--accent-primary) !important;
    background-color: color-mix(in srgb, var(--accent-primary) 18%, transparent) !important;
    background: color-mix(in srgb, var(--accent-primary) 18%, transparent) !important;
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
    padding: var(--space-0-5) var(--space-2);
  }

  :global(.html-preview pre) {
    padding: var(--space-5) var(--space-6);
    overflow-x: auto;
  }

  /* Bounded so a tall screenshot still leaves the filename row and the
     rest of the detail pane visible without scrolling past the image. */
  .file-solo-thumb {
    max-height: 60vh;
  }

  .file-row-thumb {
    width: var(--size-sm);
    height: var(--size-sm);
    object-fit: cover;
    border-radius: var(--radius-xs);
  }

  .pin-badge {
    color: var(--accent-primary);
  }

  .preview-context-menu {
    position: fixed;
    min-width: 180px;
    padding: var(--space-1);
    z-index: var(--z-portal);
  }

  .context-menu-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-primary);
    font-family: var(--font-ui);
    font-size: var(--font-size-xs);
    text-align: left;
    cursor: default;
    transition: var(--transition-fast);
  }

  .context-menu-item:hover {
    background: var(--bg-hover);
  }

  .context-menu-item:focus-visible {
    box-shadow: var(--shadow-focus);
  }

  .context-menu-icon {
    color: var(--text-secondary);
  }
</style>
