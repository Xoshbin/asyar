import type { IShortcutsService, ShortcutInfo } from './IShortcutsService';
import { BaseServiceProxy } from './BaseServiceProxy';

/** User shortcuts can run for minutes, so the default 10 s IPC timeout is too short. */
const RUN_TIMEOUT_MS = 300_000;

/**
 * SDK proxy for Apple Shortcuts. The host's IPC router injects the calling
 * extension's ID, which the permission gates check.
 */
export class ShortcutsServiceProxy extends BaseServiceProxy implements IShortcutsService {
  async list(): Promise<ShortcutInfo[]> {
    return this.broker.invoke<ShortcutInfo[]>('shortcuts:list', {});
  }

  async run(idOrName: string, input?: string): Promise<string> {
    return this.broker.invoke<string>(
      'shortcuts:run',
      { idOrName, input: input ?? null },
      undefined,
      RUN_TIMEOUT_MS,
    );
  }
}
