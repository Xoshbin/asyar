import { BaseServiceProxy } from './BaseServiceProxy';
import type { IInteropService } from './IInteropService';

export class InteropServiceProxy extends BaseServiceProxy implements IInteropService {
  async launchCommand(
    extensionId: string,
    commandId: string,
    args?: Record<string, unknown>
  ): Promise<void> {
    await this.broker.invoke<void>('interop:launchCommand', {
      extensionId,
      commandId,
      args: args ?? null,
    });
  }
}
