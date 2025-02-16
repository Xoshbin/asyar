import { log } from "@asyar/api";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
import { getClipboardStore } from "../stores/clipboardStore";
import type { ClipboardItem } from "../types";

export class ClipboardService {
  static async getHistory(): Promise<ClipboardItem[]> {
    const store = await getClipboardStore();
    return store.getHistory();
  }

  static async read(): Promise<string> {
    try {
      return await readText();
    } catch (error) {
      console.error("Failed to read from clipboard:", error);
      return "";
    }
  }

  static async write(content: string): Promise<boolean> {
    log.info(`ClipboardService Copied result: ${content}`);
    try {
      await writeText(content);
      const store = await getClipboardStore();
      await store.addItem(content);
      return true;
    } catch (error) {
      console.error("Failed to write to clipboard:", error);
      return false;
    }
  }

  static formatClipboardContent(
    content: string,
    maxLength: number = 50
  ): string {
    return content.length > maxLength
      ? `${content.substring(0, maxLength)}...`
      : content;
  }
}
