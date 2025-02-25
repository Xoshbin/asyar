import type { ActionResult } from "../types";
import { LogService } from "../services/logService";
import { WindowService } from "../services/windowService";
import { ApplicationService } from "../services/applicationService";
import { ClipboardService } from "../services/clipboardService";
import extensionManager from "../services/extensionManager";

/**
 * API wrapper for extensions to interact with the application
 */
export class ExtensionApi {
  /**
   * Clipboard operations
   */
  static clipboard = {
    async readText(): Promise<string> {
      return await ClipboardService.readText();
    },

    async writeText(text: string): Promise<void> {
      await ClipboardService.writeText(text);
    },

    async readImage(): Promise<string> {
      return await ClipboardService.readImage();
    },

    async writeImage(base64: string): Promise<void> {
      await ClipboardService.writeImage(base64);
    },

    async simulatePaste(): Promise<void> {
      await ClipboardService.simulatePaste();
    },
  };

  /**
   * Window operations
   */
  static window = {
    async hide(): Promise<void> {
      await WindowService.hide();
    },

    async show(): Promise<void> {
      await WindowService.show();
    },
  };

  /**
   * Application operations
   */
  static apps = {
    async list(): Promise<string[]> {
      return await ApplicationService.list();
    },

    async open(path: string): Promise<void> {
      await ApplicationService.open(path);
    },
  };

  /**
   * Navigation operations
   */
  static navigation = {
    setView(extensionId: string, viewName: string) {
      return extensionManager.navigateToView(`${extensionId}/${viewName}`);
    },
  };

  /**
   * Logging operations
   */
  static log = {
    debug(message: string): void {
      LogService.debug(`[Extension] ${message}`);
    },

    info(message: string): void {
      LogService.info(`[Extension] ${message}`);
    },

    error(message: string): void {
      LogService.error(`[Extension] ${message}`);
    },
  };
}
