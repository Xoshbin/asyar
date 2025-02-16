import { ClipboardService } from "../../services/clipboardService";
import type { ClipboardItem } from "../../types";
import { getClipboardStore } from "../../stores/clipboardStore";
import { log } from "@asyar/api";

export const clipboardApi = {
  async getHistory(): Promise<ClipboardItem[]> {
    const store = await getClipboardStore();
    return store.getHistory();
  },

  formatContent(content: string, maxLength?: number): string {
    return ClipboardService.formatClipboardContent(content, maxLength);
  },

  async copyToClipboard(content: string): Promise<boolean> {
    try {
      log.info(`Attempting to copy to clipboard: ${content}`);
      const success = await ClipboardService.write(content);

      if (success) {
        const store = await getClipboardStore();
        await store.addItem(content);
        log.info(`Successfully copied and saved to history: ${content}`);
        return true;
      } else {
        log.error(`Failed to write to clipboard: ${content}`);
        return false;
      }
    } catch (error) {
      log.error(`Error in copyToClipboard: ${error}`);
      return false;
    }
  },
} as const;
