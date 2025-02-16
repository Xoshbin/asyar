import { ClipboardService } from "../../services/clipboard";
import type { ClipboardItem } from "../../types/clipboardItem";
import { getClipboardStore } from "../../stores/clipboardStore";

export const clipboardApi = {
  async getHistory(): Promise<ClipboardItem[]> {
    const store = await getClipboardStore();
    return store.getHistory();
  },

  async copyToClipboard(content: string): Promise<boolean> {
    return ClipboardService.write(content);
  },

  formatContent(content: string, maxLength?: number): string {
    return ClipboardService.formatClipboardContent(content, maxLength);
  },

  async clearHistory(): Promise<void> {
    const store = await getClipboardStore();
    await store.clearHistory();
  },
} as const;
