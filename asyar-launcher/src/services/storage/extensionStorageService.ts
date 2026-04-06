import {
  extKvGet,
  extKvSet,
  extKvDelete,
  extKvGetAll,
  extKvClear,
} from '../../lib/ipc/commands';

/**
 * Extension storage service — dispatched by the IPC router when extensions
 * call `context.storage.get(key)` etc. The extensionId is injected by the
 * IPC router from the calling extension's context, so extensions never see
 * other extensions' data.
 */
export const extensionStorageService = {
  async get(extensionId: string, key: string): Promise<string | null> {
    return extKvGet(extensionId, key);
  },

  async set(extensionId: string, key: string, value: string): Promise<void> {
    return extKvSet(extensionId, key, value);
  },

  async delete(extensionId: string, key: string): Promise<boolean> {
    return extKvDelete(extensionId, key);
  },

  async getAll(extensionId: string): Promise<Record<string, string>> {
    const entries = await extKvGetAll(extensionId);
    const result: Record<string, string> = {};
    for (const entry of entries) {
      result[entry.key] = entry.value;
    }
    return result;
  },

  async clear(extensionId: string): Promise<number> {
    return extKvClear(extensionId);
  },
};
