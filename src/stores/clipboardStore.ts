import { load } from "@tauri-apps/plugin-store";
import { ClipboardItem } from "../types";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { log } from "@asyar/api";

class ClipboardStore {
  private static instance: ClipboardStore;
  private history: ClipboardItem[] = [];
  private maxItems = 500;
  private lastContent: string = "";
  private store: any = null;
  private initialized = false;

  private constructor() {
    this.init();
  }

  private async init() {
    if (this.initialized) return;

    try {
      // Initialize store
      this.store = await load("clipboard.json");

      // Load saved history
      const savedHistory = (await this.store.get("history")) as ClipboardItem[];
      if (savedHistory) {
        this.history = savedHistory;
      }

      // Get initial clipboard content
      const initial = await readText();
      if (initial && !this.isDuplicate(initial)) {
        await this.addItem(initial);
      }

      this.initialized = true;

      // Start watching clipboard
      this.watchClipboard();
    } catch (error) {
      console.error("Failed to initialize clipboard store:", error);
    }
  }

  private watchClipboard() {
    setInterval(async () => {
      try {
        const current = await readText();
        if (
          current &&
          current !== this.lastContent &&
          !this.isDuplicate(current)
        ) {
          this.lastContent = current;
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
    try {
      log.info(`Adding to clipboard history: ${content}`);

      if (!content) {
        log.info("Attempted to add empty content to clipboard history");
        return;
      }

      if (this.isDuplicate(content)) {
        log.info("Skipping duplicate content in clipboard history");
        return;
      }

      const newItem: ClipboardItem = {
        id: Date.now().toString(),
        content,
        timestamp: Date.now(),
      };

      this.history.unshift(newItem);
      if (this.history.length > this.maxItems) {
        this.history.pop();
      }

      await this.saveToStore();
      log.info(`Successfully added to clipboard history: ${content}`);
    } catch (error) {
      log.error(`Failed to add item to clipboard history: ${error}`);
    }
  }

  getHistory(): ClipboardItem[] {
    return this.history;
  }

  private async saveToStore() {
    if (!this.store) {
      log.error("Store not initialized");
      return;
    }

    try {
      await this.store.set("history", this.history);
      await this.store.save();
      log.info("Successfully saved clipboard history to store");
    } catch (error) {
      log.error(`Failed to save to store: ${error}`);
    }
  }

  async clearHistory() {
    this.history = [];
    await this.saveToStore();
  }

  static async getInstance(): Promise<ClipboardStore> {
    if (!ClipboardStore.instance) {
      ClipboardStore.instance = new ClipboardStore();
      // Wait for initialization
      await ClipboardStore.instance.init();
    }
    return ClipboardStore.instance;
  }
}

// Export an async function to get the store instance
export const getClipboardStore = () => ClipboardStore.getInstance();
