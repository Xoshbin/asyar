import * as commands from "../../lib/ipc/commands";
import { searchService } from "../search/SearchService";
import type { IWindowService } from "./interfaces/IWindowService";

export class WindowService implements IWindowService {
  async hide(): Promise<void> {
    searchService.saveIndex();
    await commands.hideWindow();
  }

  async show(): Promise<void> {
    await commands.showWindow();
  }
}

export const windowService: IWindowService = new WindowService();
