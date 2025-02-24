import { Store, load } from "@tauri-apps/plugin-store";
import clipboard, {
  onTextUpdate,
  onImageUpdate,
  onHTMLUpdate,
  onRTFUpdate,
  onFilesUpdate,
  startListening,
  hasHTML,
  hasText,
  onClipboardUpdate,
} from "tauri-plugin-clipboard-api";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { ClipboardHistoryItem, ClipboardHistoryState } from "../types";

export class ClipboardHistoryService {
  getRetentionPeriod(): number | PromiseLike<number> {
    throw new Error("Method not implemented.");
  }
  setRetentionPeriod(retentionDays: number) {
    throw new Error("Method not implemented.");
  }
  private store: Store | null = null;
  private unlisteners: UnlistenFn[] = [];
  private readonly STORE_FILE = "clipboard-history.json";
  private readonly MAX_HISTORY_SIZE = 50;

  async initialize(): Promise<void> {
    // Initialize store
    this.store = await load(this.STORE_FILE, { autoSave: true });

    // Initialize state if empty
    const state = await this.getState();
    if (!state) {
      await this.store.set("history", {
        items: [],
        maxSize: this.MAX_HISTORY_SIZE,
      });
    }

    // Start listeners
    await this.startClipboardListeners();
  }

  private async startClipboardListeners(): Promise<void> {
    // Master clipboard update listener
    const unlistenMonitor = await startListening();
    this.unlisteners.push(() => unlistenMonitor());

    // Combined listener for clipboard updates
    this.unlisteners.push(
      await onClipboardUpdate(async () => {
        // Check content types
        const hasHtmlContent = await hasHTML();
        const hasTextContent = await hasText();

        if (hasHtmlContent) {
          const html = await clipboard.readHtml();
          await this.addHistoryItem({
            id: crypto.randomUUID(),
            content: html,
            type: "html",
            timestamp: Date.now(),
          });
        } else if (hasTextContent) {
          const text = await clipboard.readText();
          await this.addHistoryItem({
            id: crypto.randomUUID(),
            content: text,
            type: "text",
            timestamp: Date.now(),
          });
        }
      })
    );

    // Keep image listener separate as it's a different type of content
    this.unlisteners.push(
      await onImageUpdate(async (base64Image) => {
        await this.addHistoryItem({
          id: crypto.randomUUID(),
          content: base64Image,
          type: "image",
          timestamp: Date.now(),
        });
      })
    );
  }

  private async getState(): Promise<ClipboardHistoryState | null> {
    if (!this.store) return null;
    return (await this.store.get<ClipboardHistoryState>("history")) ?? null;
  }

  private async addHistoryItem(item: ClipboardHistoryItem): Promise<void> {
    if (!this.store) return;

    const state = await this.getState();
    if (!state) return;

    // Check for duplicate content
    const isDuplicate = state.items.some(
      (existingItem) =>
        existingItem.content === item.content && existingItem.type === item.type
    );

    if (isDuplicate) return;

    // Add new item at the beginning and limit size
    state.items = [item, ...state.items.slice(0, state.maxSize - 1)];
    await this.store.set("history", state);
  }

  async getHistory(): Promise<ClipboardHistoryItem[]> {
    const state = await this.getState();
    return state?.items ?? [];
  }

  async restoreItem(item: ClipboardHistoryItem): Promise<void> {
    switch (item.type) {
      case "text":
        await clipboard.writeText(item.content);
        break;
      case "image":
        await clipboard.writeImageBase64(item.content);
        break;
      case "html":
        // Assuming HTML write support in clipboard plugin
        await clipboard.writeHtml(item.content);
        break;
      // Add other type handlers as needed
    }
  }

  async clearHistory(): Promise<void> {
    if (!this.store) return;
    await this.store.set("history", {
      items: [],
      maxSize: this.MAX_HISTORY_SIZE,
    });
  }

  async destroy(): Promise<void> {
    // Cleanup listeners
    for (const unlisten of this.unlisteners) {
      unlisten();
    }
    this.unlisteners = [];

    // Save store
    if (this.store) {
      await this.store.save();
    }
  }
}
