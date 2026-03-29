import Fuse from "fuse.js";
import { logService as globalLogService } from "../../services/log/logService";
import type {
  ClipboardHistoryItem,
  IClipboardHistoryService,
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

  filtered = $derived(this.searchQuery.length > 0);

  private clipboardService?: IClipboardHistoryService;
  private logService?: any;

  initializeServices(context: ExtensionContext) {
    this.clipboardService = context.getService<IClipboardHistoryService>(
      "ClipboardHistoryService"
    );
    this.logService = context.getService("LogService");
  }

  setSearch(query: string) {
    this.searchQuery = query;
    this.lastSearch = Date.now();
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

  setItems(newItems: ClipboardHistoryItem[]) {
    globalLogService.debug(`Setting items in state: ${newItems.length}`);
    this.items = newItems;
    this.fuseInstance = new Fuse(newItems, fuseOptions);

    // Auto-select the first item if list is not empty
    if (newItems.length > 0) {
      this.selectedIndex = 0;
      this.selectedItem = newItems[0];
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

    requestAnimationFrame(() => {
      const element = document.querySelector(`[data-index="${newIndex}"]`);
      element?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });

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
        this.items = items;
        this.fuseInstance = new Fuse(items, fuseOptions);
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
