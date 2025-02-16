import { log } from "@asyar/api";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";

export class ClipboardService {
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
