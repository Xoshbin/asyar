import { invoke } from "@tauri-apps/api/core";
import { searchService } from "../search/SearchService";
import type { IWindowService } from "./interfaces/IWindowService";

export class WindowService implements IWindowService {
  async hide(): Promise<void> {
    searchService.saveIndex();
    await invoke("hide");
  }

  async show(): Promise<void> {
    await invoke("show");
  }
}

export const windowService: IWindowService = new WindowService();
