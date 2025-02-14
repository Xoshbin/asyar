import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";

export interface ClipboardItem {
  id: string;
  content: string;
  timestamp: number;
}

export class ClipboardService {
  static isClipboardCommand(query: string): boolean {
    return query.trim().toLowerCase().startsWith("cl");
  }

  static async read(): Promise<string> {
    try {
      return await readText();
    } catch (error) {
      console.error("Failed to read from clipboard:", error);
      return "";
    }
  }

  static async write(content: string): Promise<void> {
    try {
      await writeText(content);
    } catch (error) {
      console.error("Failed to write to clipboard:", error);
    }
  }

  static async copyToClipboard(content: string): Promise<boolean> {
    try {
      await this.write(content);
      return true;
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
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
