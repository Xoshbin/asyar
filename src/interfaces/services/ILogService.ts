/**
 * Interface for Log Service
 */
export interface ILogService {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string | Error): void;
}
