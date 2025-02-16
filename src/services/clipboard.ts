import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
import type { ClipboardItem } from "../types/clipboardItem";

export class ClipboardService {
  private static lastContent: string = "";

  static isClipboardCommand(query: string): boolean {
    return query.trim().toLowerCase().startsWith("cl");
  }

  static async read(): Promise<string> {
    try {
      const content = await readText();
      this.lastContent = content || "";
      return this.lastContent;
    } catch (error) {
      console.error("Failed to read from clipboard:", error);
      return "";
    }
  }

  static async write(content: string): Promise<boolean> {
    try {
      await writeText(content);
      this.lastContent = content;
      return true;
    } catch (error) {
      console.error("Failed to write to clipboard:", error);
      return false;
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

  static getLastContent(): string {
    return this.lastContent;
  }

  static formatClipboardContent(
    content: string,
    maxLength: number = 50
  ): string {
    return content.length > maxLength
      ? `${content.substring(0, maxLength)}...`
      : content;
  }

  static createClipboardItem(content: string): ClipboardItem {
    return {
      id: Date.now().toString(),
      content,
      timestamp: Date.now(),
    };
  }
}
