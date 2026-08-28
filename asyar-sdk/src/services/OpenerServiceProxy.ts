import type { IOpenerService, OpenPathOptions } from './IOpenerService';
import { BaseServiceProxy } from './BaseServiceProxy';

export class OpenerServiceProxy extends BaseServiceProxy implements IOpenerService {
  async openUrl(url: string): Promise<void> {
    return this.broker.invoke<void>('opener:open', { url });
  }

  async openPath(path: string, options?: OpenPathOptions): Promise<void> {
    return this.broker.invoke<void>('opener:openPath', { path, options });
  }

  async reveal(path: string): Promise<void> {
    return this.broker.invoke<void>('opener:reveal', { path });
  }
}
