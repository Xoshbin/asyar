import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";

export class ApplicationService {
  static async list(): Promise<string[]> {
    return await invoke("list_applications");
  }

  static async open(path: string): Promise<void> {
    await openPath(path);
  }
}
