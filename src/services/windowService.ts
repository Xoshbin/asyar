import { invoke } from "@tauri-apps/api/core";
import type { IWindowService } from "../interfaces/services/IWindowService";

export class WindowService implements IWindowService {
  async hide(): Promise<void> {
    await invoke("hide");
  }

  async show(): Promise<void> {
    await invoke("show");
  }
}
