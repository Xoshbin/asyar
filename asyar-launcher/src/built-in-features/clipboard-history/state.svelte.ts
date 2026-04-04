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
} from "asyar-sdk";


export class ClipboardViewStateClass {
  searchQuery = $state("");
  lastSearch = $state(Date.now());
  items = $state<ClipboardHistoryItem[]>([]);
  selectedItemId = $state<string | null>(null);

  filteredItems = $derived.by(() => {
    const query = this.searchQuery?.trim() ?? '';
    
    // Build search engine items
    this.searchEngine.setItems(this.items);
    const searched = query ? this.searchEngine.search(query) : this.items;

    // Apply type filter on top of search results
    if (this.typeFilter === 'all') return searched;
    if (this.typeFilter === 'text') return searched.filter(i => i.type === 'text' || i.type === 'html' || i.type === 'rtf');
    if (this.typeFilter === 'images') return searched.filter(i => i.type === 'image');
    if (this.typeFilter === 'files') return searched.filter(i => i.type === 'files');
    return searched;
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
      "ClipboardHistoryService"
    );
    this.logService = context.getService("LogService");
    this.networkService = context.getService<INetworkService>("NetworkService");
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

    const current = this.selectedIndex;
    let newIndex: number;
    if (direction === "up") {
      newIndex = current <= 0 ? items.length - 1 : current - 1;
    } else {
      newIndex = current >= items.length - 1 ? 0 : current + 1;
    }

    this.selectedItemId = items[newIndex].id;
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
        await this.refreshHistory();
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

    const plainText = this.getPlainText(item);

    const textItem = {
      ...($state.snapshot(item) as ClipboardHistoryItem),
      type: ClipboardItemType.Text as any,
      content: plainText,
    };
    await this.clipboardService.pasteItem(textItem);
  }

  async handleItemAction(
    item: ClipboardHistoryItem,
    action: "paste" | "select" | "favorite"
  ) {
    if (!item?.id || !this.clipboardService) return;

    try {
      switch (action) {
        case "paste":
          await this.clipboardService.pasteItem(
            $state.snapshot(item) as ClipboardHistoryItem
          );
          break;

        case "select":
          this.selectedItemId = item.id;
          break;
      }
    } catch (error) {
      this.logService?.error(`Failed to handle item action: ${error}`);
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
      if (this.clipboardService) {
        const items = await this.clipboardService.getRecentItems(100);
        const sorted = this.sortItemsByFavorite(items);
        this.items = sorted;
      } else {
        this.logService?.warn("Clipboard service not available in refreshHistory");
      }
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
