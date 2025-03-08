import { windowService } from "../services/windowService";
import type { IWindowApi } from "./interfaces/IWindowApi";

/**
 * API for window operations
 */
export class WindowApi implements IWindowApi {
  /**
   * Hide the application window
   */
  async hide(): Promise<void> {
    await windowService.hide();
  }

  /**
   * Show the application window
   */
  async show(): Promise<void> {
    await windowService.show();
  }
}
