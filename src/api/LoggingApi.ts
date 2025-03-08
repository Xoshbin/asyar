import { logService } from "../services/LogService";
import type { ILoggingApi } from "./interfaces/ILoggingApi";

/**
 * API for logging operations
 */
export class LoggingApi implements ILoggingApi {
  /**
   * Log information message
   */
  info(message: string): void {
    logService.info(message);
  }

  /**
   * Log debug message
   */
  debug(message: string): void {
    logService.debug(message);
  }

  /**
   * Log warning message
   */
  warn(message: string): void {
    logService.warn(message);
  }

  /**
   * Log error message
   */
  error(message: string | Error): void {
    logService.error(message);
  }
}
