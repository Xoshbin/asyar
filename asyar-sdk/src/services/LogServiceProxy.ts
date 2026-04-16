import type { ILogService } from "./LogService";
import { BaseServiceProxy } from "./BaseServiceProxy";

export class LogServiceProxy extends BaseServiceProxy implements ILogService {
  debug(message: string): void {
    this.broker.invoke('log:debug', { message }).catch(err => console.warn('[LogServiceProxy] debug failed:', err));
  }

  info(message: string): void {
    this.broker.invoke('log:info', { message }).catch(err => console.warn('[LogServiceProxy] info failed:', err));
  }

  warn(message: string): void {
    this.broker.invoke('log:warn', { message }).catch(err => console.warn('[LogServiceProxy] warn failed:', err));
  }

  error(message: string | Error): void {
    const errorMessage = message instanceof Error ? message.message : message;
    this.broker.invoke('log:error', { message: errorMessage }).catch(err => console.warn('[LogServiceProxy] error failed:', err));
  }

  custom(message: string, category: string, colorName: string, frameName?: string): void {
    this.broker.invoke('log:custom', { message, category, colorName, frameName }).catch(err => console.warn('[LogServiceProxy] custom failed:', err));
  }
}

