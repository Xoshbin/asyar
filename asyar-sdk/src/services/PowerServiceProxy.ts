import type { IPowerService, KeepAwakeOptions, ActiveInhibitor } from './IPowerService';
import { BaseServiceProxy } from './BaseServiceProxy';

/**
 * SDK proxy for the power inhibitor service.
 *
 * The host's IPC router automatically injects the calling extension's ID
 * into every call, so extensions can only see and release their own tokens.
 */
export class PowerServiceProxy extends BaseServiceProxy implements IPowerService {
  async keepAwake(options: KeepAwakeOptions): Promise<string> {
    return this.broker.invoke<string>('power:keepAwake', { options });
  }

  async release(token: string): Promise<void> {
    return this.broker.invoke<void>('power:release', { token });
  }

  async list(): Promise<ActiveInhibitor[]> {
    return this.broker.invoke<ActiveInhibitor[]>('power:list', {});
  }
}
