import { load } from "@tauri-apps/plugin-store";
import { ClipboardService } from "../services/clipboard";
import type { ClipboardItem } from "../types/clipboardItem";

class ClipboardStore {
  private static instance: ClipboardStore;
  private history: ClipboardItem[] = [];
  private maxItems = 50;
  private lastContent: string = "";
  private store: any = null;
  private initialized = false;

  private constructor() {
    this.init();
  }

  private async init() {
    if (this.initialized) return;

    try {
      this.store = await load("clipboard.json");
      const savedHistory = (await this.store.get("history")) as ClipboardItem[];
      if (savedHistory) {
        this.history = savedHistory;
      }

      const initial = await ClipboardService.read();
      if (initial && !this.isDuplicate(initial)) {
        await this.addItem(initial);
      }

      this.initialized = true;
      this.watchClipboard();
    } catch (error) {
      console.error("Failed to initialize clipboard store:", error);
    }
  }

  private watchClipboard() {
    setInterval(async () => {
      try {
        const current = await ClipboardService.read();
        if (
          current &&
          current !== ClipboardService.getLastContent() &&
          !this.isDuplicate(current)
        ) {
          await this.addItem(current);
        }
      } catch (error) {
        console.error("Failed to read clipboard:", error);
      }
    }, 1000);
  }

  private isDuplicate(content: string): boolean {
    return this.history.some((item) => item.content === content);
  }

  async addItem(content: string) {
    if (!content || this.isDuplicate(content)) return;

    const newItem = ClipboardService.createClipboardItem(content);

    this.history.unshift(newItem);
    if (this.history.length > this.maxItems) {
      this.history.pop();
    }

    if (this.store) {
      await this.store.set("history", this.history);
      await this.store.save();
    }
  }

  getHistory(): ClipboardItem[] {
    return this.history;
  }

  private async saveToStore() {
    try {
      await this.store.set("history", this.history);
      await this.store.save();
    } catch (error) {
      console.error("Failed to save to store:", error);
    }
  }

  async clearHistory() {
    this.history = [];
    await this.saveToStore();
  }

  static async getInstance(): Promise<ClipboardStore> {
    if (!ClipboardStore.instance) {
      ClipboardStore.instance = new ClipboardStore();
      await ClipboardStore.instance.init();
    }
    return ClipboardStore.instance;
  }
}

export const getClipboardStore = () => ClipboardStore.getInstance();
