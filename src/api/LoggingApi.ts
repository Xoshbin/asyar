import { LogService } from "../services/logService";

export class LoggingApi {
  static debug(message: string): void {
    LogService.debug(`[Extension] ${message}`);
  }

  static info(message: string): void {
    LogService.info(`[Extension] ${message}`);
  }

  static error(message: string): void {
    LogService.error(`[Extension] ${message}`);
  }
}
