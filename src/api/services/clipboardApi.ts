import { ClipboardService } from "../../services/clipboardService";
import { log } from "./log";

export const clipboardApi = {
  async getHistory() {
    return ClipboardService.getHistory();
  },

  formatContent(content: string, maxLength?: number): string {
    return ClipboardService.formatClipboardContent(content, maxLength);
  },

  async copyToClipboard(content: string): Promise<boolean> {
    try {
      log.info(`Attempting to copy to clipboard: ${content}`);
      await ClipboardService.write(content);
      return true;
    } catch (error) {
      log.error(`Error in copyToClipboard: ${error}`);
      return false;
    }
  },
} as const;
