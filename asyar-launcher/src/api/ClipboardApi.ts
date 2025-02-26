import { ClipboardService } from "../services/clipboardService";

export class ClipboardApi {
  static async readText(): Promise<string> {
    return await ClipboardService.readText();
  }

  static async writeText(text: string): Promise<void> {
    await ClipboardService.writeText(text);
  }

  static async readImage(): Promise<string> {
    return await ClipboardService.readImage();
  }

  static async writeImage(base64: string): Promise<void> {
    await ClipboardService.writeImage(base64);
  }

  static async simulatePaste(): Promise<void> {
    await ClipboardService.simulatePaste();
  }
}
