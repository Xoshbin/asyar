import clipboard from "tauri-plugin-clipboard-api";
import { invoke } from "@tauri-apps/api/core";

export class ClipboardService {
  static async readText(): Promise<string> {
    return await clipboard.readText();
  }

  static async writeText(text: string): Promise<void> {
    await clipboard.writeText(text);
  }

  static async readImage(): Promise<string> {
    try {
      const base64 = await clipboard.readImageBase64();
      if (base64) return base64;
    } catch (e) {
      console.debug("Base64 image read failed:", e);
    }

    try {
      const objectURL = await clipboard.readImageObjectURL();
      if (objectURL) return objectURL;
    } catch (e) {
      console.debug("ObjectURL image read failed:", e);
    }

    throw new Error("No image found in clipboard");
  }

  static async writeImage(base64: string): Promise<void> {
    await clipboard.writeImageBase64(base64);
  }

  static async simulatePaste(): Promise<void> {
    await invoke("simulate_paste");
  }
}
