import { info, error, debug, attachConsole } from "@tauri-apps/plugin-log";

export class LogService {
  static async init() {
    // Attach console to see logs in terminal
    await attachConsole();
    info("[Asyar] Logger initialized");
  }

  static info(message: string): void {
    console.info(`[Asyar] ${message}`); // Add console logging
    info(`[Asyar] ${message}`);
  }

  static error(message: string): void {
    console.error(`[Asyar Error] ${message}`); // Add console logging
    error(`[Asyar Error] ${message}`);
  }

  static debug(message: string): void {
    console.debug(`[Asyar Debug] ${message}`); // Add console logging
    debug(`[Asyar Debug] ${message}`);
  }
}
