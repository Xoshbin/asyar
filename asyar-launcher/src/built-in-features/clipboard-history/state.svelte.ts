import { t } from '../../services/i18n';
import { logService as globalLogService } from '../../services/log/logService';
import {
  type ClipboardHistoryItem,
  type IClipboardHistoryService,
  type INetworkService,
  type ExtensionContext,
  ClipboardItemType,
  stripHtml,
  stripRtf,
} from 'asyar-sdk/contracts';
import { shiftIndex } from '../../lib/listSelection.svelte';
import { clipboardHistoryStore } from '../../services/clipboard/stores/clipboardHistoryStore.svelte';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import * as commands from '../../lib/ipc/commands';
import { parseClipboardSearchQuery } from './queryFilterParser';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { openerService } from '../../services/opener/openerService';
import { getHostPlatform } from '../../lib/keyboard/hostPlatform';
import { IMAGE_EXT_RE, parseFilePaths } from './filePreview';

export class ClipboardViewStateClass {
  searchQuery = $state('');
  lastSearch = $state(Date.now());
  items = $state<ClipboardHistoryItem[]>([]);
  selectedItemId = $state<string | null>(null);
  /** Ordered multi-selection (Cmd/Ctrl+Click, Cmd/Ctrl+Arrow) — append-on-add,
   *  independent of the single `selectedItemId` cursor above. Used by
   *  `pasteMergedSelection` to merge-paste in selection order. */
  selectedIds = $state<string[]>([]);

  // Search is now Rust-FTS-backed in the store; `this.items` is mirrored
  // from the store (favorites + recent when not searching, searchResults
  // when FTS has answered). We only apply the type filter on top — no
  // local SearchEngine pass. The old local search filtered `this.items`
  // by query *the instant the user typed*, before FTS had returned, so
  // for queries whose matches lived outside the loaded window the view
  // went empty for ~half a second until FTS came back. Skipping the
  // local pass keeps the previous content visible during the wait.
  parsedQuery = $derived(parseClipboardSearchQuery(this.searchQuery));

  filteredItems = $derived.by(() => {
    const parsed = this.parsedQuery;
    const effectiveType = parsed.typeFilter !== 'all' ? parsed.typeFilter : this.typeFilter;
    let result = this.items;

    if (effectiveType === 'text') {
      result = result.filter((i) => i.type === 'text' || i.type === 'html' || i.type === 'rtf');
    } else if (effectiveType === 'images') {
      result = result.filter((i) => i.type === 'image');
    } else if (effectiveType === 'files') {
      result = result.filter((i) => i.type === 'files');
    }

    if (parsed.appFilter) {
      const needle = parsed.appFilter.toLowerCase();
      result = result.filter((i) => {
        const name = (i.sourceApp?.name ?? '').toLowerCase();
        const bundleId = (i.sourceApp?.bundleId ?? '').toLowerCase();
        return name.includes(needle) || bundleId.includes(needle);
      });
    }

    const createdAfter = parsed.sqlFilter?.createdAfter;
    const createdBefore = parsed.sqlFilter?.createdBefore;
    if (createdAfter != null || createdBefore != null) {
      result = result.filter((i) => {
        if (createdAfter != null && i.createdAt < createdAfter) return false;
        if (createdBefore != null && i.createdAt > createdBefore) return false;
        return true;
      });
    }

    return result;
  });

  selectedIndex = $derived.by(() => {
    if (!this.selectedItemId || !this.filteredItems.length) return 0;
    const idx = this.filteredItems.findIndex((i) => i.id === this.selectedItemId);
    return idx >= 0 ? idx : 0;
  });

  selectedItem = $derived(this.filteredItems[this.selectedIndex] ?? null);

  /** `selectedIds` resolved against the current `filteredItems`, in
   *  selection order. Ids that scrolled out of the loaded window or were
   *  filtered out simply drop — no extra sync effect needed. */
  multiSelectedItems = $derived.by(() => {
    return this.selectedIds
      .map((id) => this.filteredItems.find((i) => i.id === id))
      .filter((i): i is ClipboardHistoryItem => i != null);
  });
  isLoading = $state(true);
  loadError = $state(false);
  errorMessage = $state('');
  typeFilter = $state<string>('all');
  showRenderedHtml = $state(
    (() => {
      try {
        const v = localStorage.getItem('clipboard:showRendered');
        return v === null ? true : v === 'true';
      } catch {
        return true;
      }
    })(),
  );

  filtered = $derived(this.searchQuery.length > 0);

  private clipboardService?: IClipboardHistoryService;
  private logService?: any;
  networkService?: INetworkService;

  initializeServices(context: ExtensionContext) {
    this.clipboardService = context.getService<IClipboardHistoryService>('clipboard');
    this.logService = context.getService('log');
    this.networkService = context.getService<INetworkService>('network');
  }

  /** Follow a recaptured item's identity without moving the cursor to an
   * unrelated row. The mounted view owns this subscription's lifetime. */
  subscribeToHistoryChanges(): () => void {
    return clipboardHistoryStore.subscribe((event) => {
      if (event.type !== 'upsert' || !event.replacedItemId) return;
      if (this.selectedItemId === event.replacedItemId) {
        this.selectedItemId = event.itemId;
      }
      this.selectedIds = [
        ...new Set(this.selectedIds.map((id) => (id === event.replacedItemId ? event.itemId : id))),
      ];
    });
  }

  setSearch(query: string) {
    this.searchQuery = query;
    this.lastSearch = Date.now();
  }

  setTypeFilter(filter: string) {
    this.typeFilter = filter;
  }

  toggleHtmlView() {
    this.showRenderedHtml = !this.showRenderedHtml;
    try {
      localStorage.setItem('clipboard:showRendered', String(this.showRenderedHtml));
    } catch {
      // localStorage may not be available in test environments
    }
  }

  getTypeFilteredItems(): ClipboardHistoryItem[] {
    if (this.typeFilter === 'all') return this.items;
    if (this.typeFilter === 'text') {
      return this.items.filter((i) => i.type === 'text' || i.type === 'html' || i.type === 'rtf');
    }
    if (this.typeFilter === 'images') {
      return this.items.filter((i) => i.type === 'image');
    }
    if (this.typeFilter === 'files') {
      return this.items.filter((i) => i.type === 'files');
    }
    return this.items;
  }

  reset() {
    this.searchQuery = '';
    this.lastSearch = Date.now();
    this.selectedItemId = null;
    this.selectedIds = [];
    this.isLoading = true;
    this.loadError = false;
    this.errorMessage = '';
    this.typeFilter = 'all';
    this.showRenderedHtml = false;
  }

  private sortItemsByFavorite(items: ClipboardHistoryItem[]): ClipboardHistoryItem[] {
    const favorites = items.filter((i) => i.favorite);
    const rest = items.filter((i) => !i.favorite);
    return [...favorites, ...rest];
  }

  setItems(newItems: ClipboardHistoryItem[]) {
    globalLogService.debug(`Setting items in state: ${newItems.length}`);
    const sorted = this.sortItemsByFavorite(newItems);
    this.items = sorted;
    this.selectedItemId = sorted.length > 0 ? sorted[0].id : null;
  }

  setSelectedItem(index: number) {
    const item = this.filteredItems[index];
    if (item) {
      this.selectedItemId = item.id;
    }
  }

  moveSelection(direction: 'up' | 'down') {
    const items = this.filteredItems;
    if (!items.length) return;
    const next = shiftIndex(this.selectedIndex, items.length, direction);
    this.selectedItemId = items[next].id;
  }

  /** Toggle a row into/out of the multi-selection (Cmd/Ctrl+Click) and move
   *  the cursor/detail pane to it. */
  toggleMultiSelect(id: string) {
    if (this.selectedIds.includes(id)) {
      this.selectedIds = this.selectedIds.filter((x) => x !== id);
    } else {
      this.selectedIds = [...this.selectedIds, id];
    }
    this.selectedItemId = id;
  }

  isMultiSelected(id: string): boolean {
    return this.selectedIds.includes(id);
  }

  clearMultiSelect() {
    this.selectedIds = [];
  }

  /** Cmd/Ctrl+ArrowUp/Down: move the cursor and extend the multi-selection to
   *  cover both the starting row and the newly-landed row. Add-only — moving
   *  back over an already-selected row is a no-op, not a toggle-off, so
   *  "selection order" stays well-defined for a Cmd+Arrow run. */
  moveSelectionAndExtend(direction: 'up' | 'down') {
    const items = this.filteredItems;
    if (!items.length) return;
    if (this.selectedItemId && !this.selectedIds.includes(this.selectedItemId)) {
      this.selectedIds = [...this.selectedIds, this.selectedItemId];
    }
    this.moveSelection(direction);
    if (this.selectedItemId && !this.selectedIds.includes(this.selectedItemId)) {
      this.selectedIds = [...this.selectedIds, this.selectedItemId];
    }
  }

  setLoading(isLoading: boolean) {
    this.isLoading = isLoading;
  }

  setError(error: string | null) {
    this.loadError = !!error;
    this.errorMessage = error || '';
  }

  async clearNonFavorites() {
    if (!this.clipboardService) {
      this.logService?.error('Clipboard service not initialized in clearNonFavorites');
      return false;
    }
    try {
      return await this.clipboardService.clearNonFavorites();
    } catch (error) {
      this.logService?.error(`Error clearing non-favorites: ${error}`);
      return false;
    }
  }

  async toggleFavorite(itemId: string) {
    if (!this.clipboardService) {
      this.logService?.error('Clipboard service not initialized in toggleFavorite');
      return false;
    }
    try {
      return await this.clipboardService.toggleItemFavorite(itemId);
    } catch (error) {
      this.logService?.error(`Error toggling favorite for ${itemId}: ${error}`);
      return false;
    }
  }

  async deleteItem(itemId: string): Promise<boolean> {
    if (!this.clipboardService) {
      this.logService?.error('Clipboard service not initialized in deleteItem');
      return false;
    }
    try {
      const result = await this.clipboardService.deleteItem(itemId);
      if (result) {
        await clipboardHistoryStore.deleteHistoryItem(itemId);
        this.items = this.items.filter((i) => i.id !== itemId);
        if (this.selectedItemId === itemId) {
          this.selectedItemId = this.items.length > 0 ? this.items[0].id : null;
        }
      }
      return result;
    } catch (error) {
      this.logService?.error(`Error deleting item ${itemId}: ${error}`);
      return false;
    }
  }

  async getPlainText(item: ClipboardHistoryItem): Promise<string> {
    const source = item.content
      ? item
      : ((await clipboardHistoryStore.fetchFullItem(item.id)) as ClipboardHistoryItem | null);
    if (!source) return '';

    if (source.type === ClipboardItemType.Html) {
      return stripHtml(source.content || '');
    } else if (source.type === ClipboardItemType.Rtf) {
      return stripRtf(source.content || '');
    }
    return source.content || '';
  }

  async pasteAsPlainText() {
    const item = this.selectedItem;
    if (!item || !this.clipboardService) return;

    try {
      if (item.content) {
        const plainText = await this.getPlainText(item);
        await this.clipboardService.pasteItem({
          ...($state.snapshot(item) as ClipboardHistoryItem),
          type: ClipboardItemType.Text as any,
          content: plainText,
        });
      } else {
        // Path B: list-row payload — fetch the full row first.
        const full = await clipboardHistoryStore.fetchFullItem(item.id);
        if (full) {
          const source = full as unknown as ClipboardHistoryItem;
          const plainText = await this.getPlainText(source);
          await this.clipboardService.pasteItem({
            ...source,
            type: ClipboardItemType.Text as any,
            content: plainText,
          });
        }
      }
    } catch (error) {
      this.logService?.error(`Failed to paste as plain text: ${error}`);
      feedbackService.report({
        source: 'frontend',
        kind: 'clipboard/paste-failed',
        severity: 'error',
        retryable: false,
        developerDetail: String(error),
      });
    }
  }

  /** Merge-paste every multi-selected item's plain text, in selection order,
   *  as a single clipboard write + single simulated paste. The
   *  fetch/decrypt/strip/join transformation runs server-side in Rust
   *  (`clipboardGetMergedText`) — this method only orchestrates the ordered
   *  id list and the final write+paste step. */
  async pasteMergedSelection() {
    if (!this.clipboardService) {
      this.logService?.error('Clipboard service not initialized in pasteMergedSelection');
      return;
    }
    if (this.selectedIds.length < 2) return;

    try {
      // Checked up front (mirrors the internal check in
      // clipboardHistoryService.pasteItem): a permission-denied no-op must
      // not clear the selection the user just built.
      if (!(await commands.checkAccessibilityPermission())) {
        await commands.openAccessibilityPreferences();
        feedbackService.report({
          source: 'frontend',
          kind: 'manual',
          severity: 'warning',
          retryable: false,
          context: {
            message: t('features.clipboard.paste_permission'),
          },
        });
        return;
      }

      const merged = await commands.clipboardGetMergedText(this.selectedIds);
      const text = merged?.text ?? '';
      const skippedCount = merged?.skippedCount ?? 0;

      if (!text.trim()) {
        if (skippedCount > 0) {
          feedbackService.report({
            source: 'frontend',
            kind: 'manual',
            severity: 'warning',
            retryable: false,
            context: {
              message: t('features.clipboard.merge_nothing', { count: skippedCount }),
            },
          });
        }
        return;
      }

      await this.clipboardService.pasteItem({
        id: 'merged-selection',
        type: ClipboardItemType.Text as any,
        content: text,
        createdAt: Date.now(),
        favorite: false,
      } as ClipboardHistoryItem);

      this.clearMultiSelect();

      if (skippedCount > 0) {
        feedbackService.report({
          source: 'frontend',
          kind: 'manual',
          severity: 'warning',
          retryable: false,
          context: {
            message: t('features.clipboard.merge_skipped', { count: skippedCount }),
          },
        });
      }
    } catch (error) {
      this.logService?.error(`Failed to paste merged selection: ${error}`);
      feedbackService.report({
        source: 'frontend',
        kind: 'clipboard/paste-failed',
        severity: 'error',
        retryable: false,
        developerDetail: String(error),
      });
    }
  }

  async handleItemAction(item: ClipboardHistoryItem, action: 'paste' | 'select' | 'favorite') {
    if (!item?.id || !this.clipboardService) return;

    try {
      switch (action) {
        case 'paste':
          // Path A: item already carries content — paste inline. The
          // $state.snapshot(item) call MUST stay inline as a direct argument
          // to pasteItem so the Svelte compiler emits the proxy-stripping
          // clone (assigning the snapshot to a `let`/`const` first loses the
          // transform in this build).
          if (item.content) {
            await this.clipboardService.pasteItem($state.snapshot(item) as ClipboardHistoryItem);
          } else {
            // Path B: list-row payload — fetch the full row first to get content.
            const full = await clipboardHistoryStore.fetchFullItem(item.id);
            if (full) {
              await this.clipboardService.pasteItem(full as unknown as ClipboardHistoryItem);
            }
          }
          break;

        case 'select':
          this.selectedItemId = item.id;
          break;
      }
    } catch (error) {
      this.logService?.error(`Failed to handle item action: ${error}`);
      feedbackService.report({
        source: 'frontend',
        kind: 'clipboard/paste-failed',
        severity: 'error',
        retryable: false,
        developerDetail: String(error),
      });
    }
  }

  async copyItem(item: ClipboardHistoryItem): Promise<boolean> {
    if (!item?.id || !this.clipboardService) return false;
    try {
      const payload = item.content
        ? ($state.snapshot(item) as ClipboardHistoryItem)
        : ((await clipboardHistoryStore.fetchFullItem(item.id)) as ClipboardHistoryItem | null);
      if (!payload) return false;
      await this.clipboardService.writeToClipboard(payload);
      await feedbackService.showHUD(t('common.copied'));
      return true;
    } catch (error) {
      this.logService?.error(`Failed to copy clipboard item: ${error}`);
      feedbackService.report({
        source: 'frontend',
        kind: 'clipboard/copy-failed',
        severity: 'error',
        retryable: false,
        developerDetail: String(error),
      });
      return false;
    }
  }

  async revealFile(path: string): Promise<void> {
    try {
      await revealItemInDir(path);
    } catch (error) {
      (this.logService ?? globalLogService).error(`Failed to reveal file ${path}: ${error}`);
      feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: t('features.clipboard.ui.reveal_failed', { path }) },
      });
    }
  }

  async openPreviewFile(path: string, withPreview: boolean): Promise<void> {
    try {
      const options =
        withPreview && getHostPlatform() === 'macos' ? { with: 'Preview' } : undefined;
      await openerService.openPath(null, path, options);
    } catch (error) {
      (this.logService ?? globalLogService).error(`Failed to open file ${path}: ${String(error)}`);
      void feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: t('features.clipboard.ui.open_failed', { path }) },
      });
    }
  }

  async getPreviewTarget(
    item?: ClipboardHistoryItem | null,
  ): Promise<{ path: string; isImage: boolean } | null> {
    const targetItem = item ?? this.selectedItem;
    if (!targetItem) return null;

    if (targetItem.type === ClipboardItemType.Image) {
      const path = targetItem.content ?? (await fetchFullItemForId(targetItem.id))?.content;
      if (!path || path.startsWith('data:')) return null;
      return { path, isImage: true };
    }

    if (targetItem.type === ClipboardItemType.Files) {
      const content = targetItem.content ?? (await fetchFullItemForId(targetItem.id))?.content;
      const paths = parseFilePaths(content);
      if (paths.length === 1 && !paths[0].startsWith('data:')) {
        return {
          path: paths[0],
          isImage: IMAGE_EXT_RE.test(paths[0]),
        };
      }
    }

    return null;
  }

  async openSelectedItem(): Promise<void> {
    const target = await this.getPreviewTarget();
    if (target) {
      await this.openPreviewFile(target.path, target.isImage);
    }
  }

  async revealSelectedItem(): Promise<void> {
    const target = await this.getPreviewTarget();
    if (target) {
      await this.revealFile(target.path);
    }
  }

  async copyTextFromImage(item: ClipboardHistoryItem): Promise<boolean> {
    const target = await this.getPreviewTarget(item);
    const path = target?.path ?? item.content ?? (await fetchFullItemForId(item.id))?.content;
    if (!path) return false;
    try {
      const text = await commands.ocrCopyImageText(path);
      if (text) {
        await feedbackService.showHUD(t('ocr_copied'));
        return true;
      }
      await feedbackService.showHUD(t('features.clipboard.ui.ocr_no_text'));
      return false;
    } catch (error) {
      this.logService?.error(`Failed to copy text from image: ${error}`);
      feedbackService.report({
        source: 'frontend',
        kind: 'clipboard/copy-failed',
        severity: 'error',
        retryable: false,
        developerDetail: String(error),
      });
      return false;
    }
  }

  async hidePanel() {
    if (!this.clipboardService) {
      this.logService?.error('Clipboard service not initialized in hidePanel');
      return;
    }
    try {
      await this.clipboardService.hideWindow();
    } catch (error) {
      this.logService?.error(`Error hiding window: ${error}`);
    }
  }

  async refreshHistory() {
    this.isLoading = true;
    try {
      const filter = this.parsedQuery.sqlFilter;
      await (filter
        ? clipboardHistoryStore.loadInitial(100, filter)
        : clipboardHistoryStore.loadInitial(100));
    } catch (error) {
      this.logService?.error(`Failed to refresh clipboard history: ${error}`);
      this.loadError = true;
      this.errorMessage = `Failed to refresh clipboard history: ${error}`;
    } finally {
      this.isLoading = false;
    }
  }
}

export const clipboardViewState = new ClipboardViewStateClass();

/** Call when the view is opened or focused. Loads the initial window if empty. */
export async function onViewActivated(): Promise<void> {
  try {
    void clipboardHistoryStore.loadSourceApps?.();
    if (clipboardHistoryStore.favorites.length === 0 && clipboardHistoryStore.recent.length === 0) {
      await clipboardHistoryStore.loadInitial(100);
    }
  } catch (err) {
    feedbackService.report({
      source: 'frontend',
      kind: 'clipboard/load-failed',
      severity: 'error',
      retryable: false,
      developerDetail: String(err),
    });
  }
}

/** Call when the search query changes. Empty string clears the search. */
export async function onSearchChanged(query: string): Promise<void> {
  try {
    const parsed = parseClipboardSearchQuery(query);
    clipboardViewState.setTypeFilter(parsed.typeFilter);
    const filter = parsed.sqlFilter;

    if (!parsed.textQuery) {
      clipboardHistoryStore.clearSearch();
      if (parsed.hasActiveFilter && filter) {
        await clipboardHistoryStore.loadInitial(100, filter);
      } else if (clipboardHistoryStore.requestedFilter || clipboardHistoryStore.activeFilter) {
        await clipboardHistoryStore.loadInitial(100);
      }
      return;
    }

    if (filter) {
      await clipboardHistoryStore.search(parsed.textQuery, 200, filter);
    } else {
      await clipboardHistoryStore.search(parsed.textQuery, 200);
    }
  } catch (err) {
    feedbackService.report({
      source: 'frontend',
      kind: 'clipboard/search-failed',
      severity: 'error',
      retryable: false,
      developerDetail: String(err),
    });
  }
}

/** Call when the list has been scrolled near the bottom. Paginates the recent
 *  window. No-op during search mode. */
export async function onScrolledToEnd(): Promise<void> {
  try {
    if (clipboardHistoryStore.searchResults !== null) return;
    if (!clipboardHistoryStore.nextOlderCursor) return;
    await clipboardHistoryStore.loadOlder(200);
  } catch (err) {
    feedbackService.report({
      source: 'frontend',
      kind: 'clipboard/load-older-failed',
      severity: 'error',
      retryable: false,
      developerDetail: String(err),
    });
  }
}

/** Fetch the full row (content decrypted) for paste / detail. */
export async function fetchFullItemForId(id: string) {
  try {
    return await clipboardHistoryStore.fetchFullItem(id);
  } catch (err) {
    feedbackService.report({
      source: 'frontend',
      kind: 'clipboard/get-item-failed',
      severity: 'error',
      retryable: false,
      developerDetail: String(err),
    });
    return null;
  }
}

/** The list to render — search results when in search mode, otherwise
 *  favorites + recent in their order. */
export function visibleItems() {
  return (
    clipboardHistoryStore.searchResults ?? [
      ...clipboardHistoryStore.favorites,
      ...clipboardHistoryStore.recent,
    ]
  );
}
