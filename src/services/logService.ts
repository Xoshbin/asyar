import { info } from "@tauri-apps/plugin-log";

export class LogService {
  static info(message: string): void {
    info(`[Asyar] ${message}`);
  }

  static error(message: string): void {
    info(`[Asyar Error] ${message}`);
  }

  static debug(message: string): void {
    info(`[Asyar Debug] ${message}`);
  }
}
