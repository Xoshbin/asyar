import { load } from "@tauri-apps/plugin-store";
import { ClipboardItem } from "../services/clipboard";
import { readText } from "@tauri-apps/plugin-clipboard-manager";

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
    if (!content || this.isDuplicate(content)) return;

    const newItem: ClipboardItem = {
      id: Date.now().toString(),
      content,
      timestamp: Date.now(),
    };

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
      // Wait for initialization
      await ClipboardStore.instance.init();
    }
    return ClipboardStore.instance;
  }
}

// Export an async function to get the store instance
export const getClipboardStore = () => ClipboardStore.getInstance();
