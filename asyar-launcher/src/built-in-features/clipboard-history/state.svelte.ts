import Fuse from "fuse.js";
import { logService as globalLogService } from "../../services/log/logService";
import type {
  ClipboardHistoryItem,
  IClipboardHistoryService,
  INetworkService,
  ExtensionContext,
} from "asyar-sdk";

// Fuzzy search options
const fuseOptions = {
  includeScore: true,
  threshold: 0.4,
  keys: ["content"],
};

export class ClipboardViewStateClass {
  searchQuery = $state("");
  lastSearch = $state(Date.now());
  fuseInstance = $state<Fuse<ClipboardHistoryItem> | null>(null);
  items = $state<ClipboardHistoryItem[]>([]);
  selectedItem = $state<ClipboardHistoryItem | null>(null);
  selectedIndex = $state(0);
  isLoading = $state(true);
  loadError = $state(false);
  errorMessage = $state("");
  typeFilter = $state<string>("all");
  showRenderedHtml = $state((() => { try { const v = localStorage.getItem('clipboard:showRendered'); return v === null ? true : v === 'true'; } catch { return true; } })());

  filtered = $derived(this.searchQuery.length > 0);

  private clipboardService?: IClipboardHistoryService;
  private logService?: any;
  networkService?: INetworkService;

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
    this.fuseInstance = null;
    this.items = [];
    this.selectedItem = null;
    this.selectedIndex = 0;
    this.isLoading = true;
    this.loadError = false;
    this.errorMessage = "";
    this.typeFilter = "all";
    this.showRenderedHtml = false;
  }

  initFuse(items: ClipboardHistoryItem[]) {
    this.fuseInstance = new Fuse(items, fuseOptions);
  }

  search(items: ClipboardHistoryItem[], query: string) {
    let result = items;

    if (query && query.trim() !== "") {
      let fuse: Fuse<ClipboardHistoryItem>;

      if (!this.fuseInstance) {
        fuse = new Fuse(items, fuseOptions);
        this.fuseInstance = fuse;
      } else {
        fuse = this.fuseInstance;
        fuse.setCollection(items);
      }

      const searchResults = fuse.search(query);
      result = searchResults.map((res) => ({
        ...res.item,
        score: res.score,
      }));
    }

    return result;
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
    this.fuseInstance = new Fuse(sorted, fuseOptions);

    // Auto-select the first item if list is not empty
    if (sorted.length > 0) {
      this.selectedIndex = 0;
      this.selectedItem = sorted[0];
    }
  }

  setSelectedItem(index: number) {
    if (this.items.length > 0 && index >= 0 && index < this.items.length) {
      this.selectedIndex = index;
      this.selectedItem = this.items[index];
    }
  }

  moveSelection(direction: "up" | "down") {
    const items = this.items;
    if (!items.length) return;

    let newIndex = this.selectedIndex;
    if (direction === "up") {
      newIndex = newIndex <= 0 ? items.length - 1 : newIndex - 1;
    } else {
      newIndex = newIndex >= items.length - 1 ? 0 : newIndex + 1;
    }

    this.selectedIndex = newIndex;
    this.selectedItem = items[newIndex];
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

  private htmlToPlainText(html: string): string {
    try {
      const div = document.createElement("div");
      div.innerHTML = html;
      return div.textContent || div.innerText || "";
    } catch {
      return html.replace(/<[^>]+>/g, "");
    }
  }

  private rtfToPlainText(rtf: string): string {
    return rtf
      .replace(/\\u-?\d+\??/g, "")
      .replace(/\\[a-z]+\-?\d*[ ]?/gi, "")
      .replace(/[{}\\]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  async pasteAsPlainText() {
    const item = this.selectedItem;
    if (!item || !this.clipboardService) return;

    let plainText: string;
    if (item.type === "html") {
      plainText = this.htmlToPlainText(item.content || "");
    } else if (item.type === "rtf") {
      plainText = this.rtfToPlainText(item.content || "");
    } else {
      plainText = item.content || "";
    }

    const textItem = {
      ...($state.snapshot(item) as ClipboardHistoryItem),
      type: "text" as any,
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
          const index = this.items.findIndex((i) => i.id === item.id);
          if (index >= 0) {
            this.setSelectedItem(index);
          }
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
        this.fuseInstance = new Fuse(sorted, fuseOptions);
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
