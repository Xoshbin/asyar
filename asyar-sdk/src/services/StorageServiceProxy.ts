import type { IStorageService } from "./IStorageService";
import { BaseServiceProxy } from "./BaseServiceProxy";

/**
 * SDK proxy for extension key-value storage.
 *
 * The host's IPC router automatically injects the calling extension's ID,
 * so extensions can only access their own data — no cross-extension leaks.
 */
export class StorageServiceProxy extends BaseServiceProxy implements IStorageService {
  async get(key: string): Promise<string | null> {
    return this.broker.invoke<string | null>('storage:get', { key });
  }

  async set(key: string, value: string): Promise<void> {
    return this.broker.invoke<void>('storage:set', { key, value });
  }

  async delete(key: string): Promise<boolean> {
    return this.broker.invoke<boolean>('storage:delete', { key });
  }

  async getAll(): Promise<Record<string, string>> {
    return this.broker.invoke<Record<string, string>>('storage:getAll', {});
  }

  async clear(): Promise<number> {
    return this.broker.invoke<number>('storage:clear', {});
  }
}
