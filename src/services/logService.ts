import { info, error, debug, attachConsole } from "@tauri-apps/plugin-log";

/**
 * Service for logging application events
 */
export class LogService {
  /**
   * Initialize the logger
   */
  static async init(): Promise<void> {
    await attachConsole();
  }

  /**
   * Log informational message
   */
  static info(message: string): void {
    info(`[Asyar] ${message}`);
  }

  /**
   * Log error message
   */
  static error(message: string): void {
    error(`[Asyar Error] ${message}`);
  }

  /**
   * Log debug message
   */
  static debug(message: string): void {
    debug(`[Asyar Debug] ${message}`);
  }
}
