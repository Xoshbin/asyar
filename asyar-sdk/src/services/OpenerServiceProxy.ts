import type { IOpenerService } from './IOpenerService';
import { BaseServiceProxy } from './BaseServiceProxy';

export class OpenerServiceProxy extends BaseServiceProxy implements IOpenerService {
  async openUrl(url: string): Promise<void> {
    return this.broker.invoke<void>('opener:open', { url });
  }
}
