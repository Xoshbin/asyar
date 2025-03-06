import { info, error, debug, attachConsole } from "@tauri-apps/plugin-log";

export class LogService {
  static async init() {
    // Attach console to see logs in terminal
    await attachConsole();
    // info("[Asyar] Logger initialized");
  }

  static info(message: string): void {
    info(`[Asyar] ${message}`);
  }

  static error(message: string): void {
    error(`[Asyar Error] ${message}`);
  }

  static debug(message: string): void {
    debug(`[Asyar Debug] ${message}`);
  }
}
