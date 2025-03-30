import { invoke } from "@tauri-apps/api/core";
import type { IWindowService } from "./interfaces/IWindowService";

export class WindowService implements IWindowService {
  async hide(): Promise<void> {
    await invoke("hide");
  }

  async show(): Promise<void> {
    await invoke("show");
  }
}

export const windowService: IWindowService = new WindowService();
