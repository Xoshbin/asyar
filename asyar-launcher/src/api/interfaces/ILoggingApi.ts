/**
 * Interface for Logging API
 */
export interface ILoggingApi {
  /**
   * Log information message
   */
  info(message: string): void;

  /**
   * Log debug message
   */
  debug(message: string): void;

  /**
   * Log warning message
   */
  warn(message: string): void;

  /**
   * Log error message
   */
  error(message: string | Error): void;
}
