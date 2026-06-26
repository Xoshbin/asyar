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
    await extKvSet(extensionId, key, value);
  },

  async delete(extensionId: string, key: string): Promise<boolean> {
    const result = await extKvDelete(extensionId, key);
    if (result === null) throw new Error('ext_kv_delete failed');
    return result;
  },

  async getAll(extensionId: string): Promise<Record<string, string>> {
    const entries = await extKvGetAll(extensionId);
    if (entries === null) throw new Error('ext_kv_get_all failed');
    const result: Record<string, string> = {};
    for (const entry of entries) {
      result[entry.key] = entry.value;
    }
    return result;
  },

  async clear(extensionId: string): Promise<number> {
    const result = await extKvClear(extensionId);
    if (result === null) throw new Error('ext_kv_clear failed');
    return result;
  },
};
