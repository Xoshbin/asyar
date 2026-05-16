import { logService as globalLogService } from "../../services/log/logService";
import {
  type ClipboardHistoryItem,
  type IClipboardHistoryService,
  type INetworkService,
  type ExtensionContext,
  ClipboardItemType,
  SearchEngine,
  stripHtml,
  stripRtf,
} from "asyar-sdk/contracts";
import { shiftIndex } from "../../lib/listSelection.svelte";
import { clipboardHistoryStore } from "../../services/clipboard/stores/clipboardHistoryStore.svelte";
import { diagnosticsService } from "../../services/diagnostics/diagnosticsService.svelte";


export class ClipboardViewStateClass {
  searchQuery = $state("");
  lastSearch = $state(Date.now());
  items = $state<ClipboardHistoryItem[]>([]);
  selectedItemId = $state<string | null>(null);

  // Search is now Rust-FTS-backed in the store; `this.items` is mirrored
  // from the store (favorites + recent when not searching, searchResults
  // when FTS has answered). We only apply the type filter on top — no
  // local SearchEngine pass. The old local search filtered `this.items`
  // by query *the instant the user typed*, before FTS had returned, so
  // for queries whose matches lived outside the loaded window the view
  // went empty for ~half a second until FTS came back. Skipping the
  // local pass keeps the previous content visible during the wait.
  filteredItems = $derived.by(() => {
    const base = this.items;
    if (this.typeFilter === 'all') return base;
    if (this.typeFilter === 'text') return base.filter(i => i.type === 'text' || i.type === 'html' || i.type === 'rtf');
    if (this.typeFilter === 'images') return base.filter(i => i.type === 'image');
    if (this.typeFilter === 'files') return base.filter(i => i.type === 'files');
    return base;
  });

  selectedIndex = $derived.by(() => {
    if (!this.selectedItemId || !this.filteredItems.length) return 0;
    const idx = this.filteredItems.findIndex(i => i.id === this.selectedItemId);
    return idx >= 0 ? idx : 0;
  });

  selectedItem = $derived(this.filteredItems[this.selectedIndex] ?? null);
  isLoading = $state(true);
  loadError = $state(false);
  errorMessage = $state("");
  typeFilter = $state<string>("all");
  showRenderedHtml = $state((() => { try { const v = localStorage.getItem('clipboard:showRendered'); return v === null ? true : v === 'true'; } catch { return true; } })());

  filtered = $derived(this.searchQuery.length > 0);

  private clipboardService?: IClipboardHistoryService;
  private logService?: any;
  networkService?: INetworkService;

  private searchEngine = new SearchEngine<ClipboardHistoryItem>({
    getText: (item) => {
      const preview = item.preview ?? "";
      const content = item.content ?? "";
      let plain: string;
      switch (item.type) {
        case ClipboardItemType.Html:
          plain = stripHtml(content);
          break;
        case ClipboardItemType.Rtf:
          plain = stripRtf(content);
          break;
        case ClipboardItemType.Files:
          try {
            const paths: string[] = JSON.parse(content);
            plain = paths.map((p) => p.split("/").pop() ?? p).join(" ");
          } catch {
            plain = content;
          }
          break;
        default:
          plain = content;
      }
      return `${preview} ${plain}`;
    },
  });

  initializeServices(context: ExtensionContext) {
    this.clipboardService = context.getService<IClipboardHistoryService>(
      "clipboard"
    );
    this.logService = context.getService("log");
    this.networkService = context.getService<INetworkService>("network");
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
    if (this.typeFilter === "all") return this.items;
    if (this.typeFilter === "text") {
      return this.items.filter(i => i.type === "text" || i.type === "html" || i.type === "rtf");
    }
    if (this.typeFilter === "images") {
      return this.items.filter(i => i.type === "image");
    }
    if (this.typeFilter === "files") {
      return this.items.filter(i => i.type === "files");
    }
    return this.items;
  }

  reset() {
    this.searchQuery = "";
    this.lastSearch = Date.now();
    this.selectedItemId = null;
    this.isLoading = true;
    this.loadError = false;
    this.errorMessage = "";
    this.typeFilter = "all";
    this.showRenderedHtml = false;
  }





  private sortItemsByFavorite(items: ClipboardHistoryItem[]): ClipboardHistoryItem[] {
    const favorites = items.filter(i => i.favorite);
    const rest = items.filter(i => !i.favorite);
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

  moveSelection(direction: "up" | "down") {
    const items = this.filteredItems;
    if (!items.length) return;
    const next = shiftIndex(this.selectedIndex, items.length, direction);
    this.selectedItemId = items[next].id;
  }

  setLoading(isLoading: boolean) {
    this.isLoading = isLoading;
  }

  setError(error: string | null) {
    this.loadError = !!error;
    this.errorMessage = error || "";
  }

  async clearNonFavorites() {
    if (!this.clipboardService) {
      this.logService?.error("Clipboard service not initialized in clearNonFavorites");
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
      this.logService?.error("Clipboard service not initialized in toggleFavorite");
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
      this.logService?.error("Clipboard service not initialized in deleteItem");
      return false;
    }
    try {
      const result = await this.clipboardService.deleteItem(itemId);
      if (result) {
        await clipboardHistoryStore.deleteHistoryItem(itemId);
        this.items = this.items.filter(i => i.id !== itemId);
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

  getPlainText(item: ClipboardHistoryItem): string {
    if (item.type === ClipboardItemType.Html) {
      return stripHtml(item.content || '');
    } else if (item.type === ClipboardItemType.Rtf) {
      return stripRtf(item.content || '');
    }
    return item.content || '';
  }

  async pasteAsPlainText() {
    const item = this.selectedItem;
    if (!item || !this.clipboardService) return;

    try {
      if (item.content) {
        // Path A: content present — keep $state.snapshot inline so the
        // compiler emits the proxy-stripping clone.
        const plainText = this.getPlainText(item);
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
          const plainText = this.getPlainText(source);
          await this.clipboardService.pasteItem({
            ...source,
            type: ClipboardItemType.Text as any,
            content: plainText,
          });
        }
      }
    } catch (error) {
      this.logService?.error(`Failed to paste as plain text: ${error}`);
      diagnosticsService.report({
        source: 'frontend', kind: 'clipboard/paste-failed', severity: 'error',
        retryable: false, developerDetail: String(error),
      });
    }
  }

  async handleItemAction(
    item: ClipboardHistoryItem,
    action: "paste" | "select" | "favorite"
  ) {
    if (!item?.id || !this.clipboardService) return;

    try {
      switch (action) {
        case "paste":
          // Path A: item already carries content — paste inline. The
          // $state.snapshot(item) call MUST stay inline as a direct argument
          // to pasteItem so the Svelte compiler emits the proxy-stripping
          // clone (assigning the snapshot to a `let`/`const` first loses the
          // transform in this build).
          if (item.content) {
            await this.clipboardService.pasteItem(
              $state.snapshot(item) as ClipboardHistoryItem
            );
          } else {
            // Path B: list-row payload — fetch the full row first to decrypt
            // content, then paste.
            const full = await clipboardHistoryStore.fetchFullItem(item.id);
            if (full) {
              await this.clipboardService.pasteItem(full as unknown as ClipboardHistoryItem);
            }
          }
          break;

        case "select":
          this.selectedItemId = item.id;
          break;
      }
    } catch (error) {
      this.logService?.error(`Failed to handle item action: ${error}`);
      diagnosticsService.report({
        source: 'frontend', kind: 'clipboard/paste-failed', severity: 'error',
        retryable: false, developerDetail: String(error),
      });
    }
  }

  async hidePanel() {
    if (!this.clipboardService) {
      this.logService?.error("Clipboard service not initialized in hidePanel");
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
      await clipboardHistoryStore.loadInitial(100);
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
    if (clipboardHistoryStore.favorites.length === 0 && clipboardHistoryStore.recent.length === 0) {
      await clipboardHistoryStore.loadInitial(100);
    }
  } catch (err) {
    diagnosticsService.report({
      source: 'frontend', kind: 'clipboard/load-failed', severity: 'error',
      retryable: false, developerDetail: String(err),
    });
  }
}

/** Call when the search query changes. Empty string clears the search. */
export async function onSearchChanged(query: string): Promise<void> {
  try {
    const trimmed = query.trim();
    if (!trimmed) {
      clipboardHistoryStore.clearSearch();
      return;
    }
    await clipboardHistoryStore.search(trimmed, 200);
  } catch (err) {
    diagnosticsService.report({
      source: 'frontend', kind: 'clipboard/search-failed', severity: 'error',
      retryable: false, developerDetail: String(err),
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
    diagnosticsService.report({
      source: 'frontend', kind: 'clipboard/load-older-failed', severity: 'error',
      retryable: false, developerDetail: String(err),
    });
  }
}

/** Fetch the full row (content decrypted) for paste / detail. */
export async function fetchFullItemForId(id: string) {
  try {
    return await clipboardHistoryStore.fetchFullItem(id);
  } catch (err) {
    diagnosticsService.report({
      source: 'frontend', kind: 'clipboard/get-item-failed', severity: 'error',
      retryable: false, developerDetail: String(err),
    });
    return null;
  }
}

/** The list to render — search results when in search mode, otherwise
 *  favorites + recent in their order. */
export function visibleItems() {
  return clipboardHistoryStore.searchResults ?? [
    ...clipboardHistoryStore.favorites,
    ...clipboardHistoryStore.recent,
  ];
}
