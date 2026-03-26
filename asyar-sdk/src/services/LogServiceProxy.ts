import { ILogService } from "./LogService";
import { BaseServiceProxy } from "./BaseServiceProxy";

export class LogServiceProxy extends BaseServiceProxy implements ILogService {
  debug(message: string): void {
    this.broker.invoke('log:debug', { message }).catch(console.error);
  }

  info(message: string): void {
    this.broker.invoke('log:info', { message }).catch(console.error);
  }

  warn(message: string): void {
    this.broker.invoke('log:warn', { message }).catch(console.error);
  }

  error(message: string | Error): void {
    const errorMessage = message instanceof Error ? message.message : message;
    this.broker.invoke('log:error', { message: errorMessage }).catch(console.error);
  }

  custom(message: string, category: string, colorName: string, frameName?: string): void {
    this.broker.invoke('log:custom', { message, category, colorName, frameName }).catch(console.error);
  }
}

