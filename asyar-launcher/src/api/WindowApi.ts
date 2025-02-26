import { WindowService } from "../services/windowService";

export class WindowApi {
  static async hide(): Promise<void> {
    await WindowService.hide();
  }

  static async show(): Promise<void> {
    await WindowService.show();
  }
}
