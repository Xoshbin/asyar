import { invoke } from "@tauri-apps/api/core";

export class WindowService {
  static async hide(): Promise<void> {
    await invoke("hide");
  }

  static async show(): Promise<void> {
    await invoke("show");
  }
}
