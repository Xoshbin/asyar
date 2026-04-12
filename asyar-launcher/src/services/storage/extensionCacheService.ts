import {
  extCacheGet,
  extCacheSet,
  extCacheDelete,
  extCacheClear,
} from '../../lib/ipc/commands';

/**
 * Extension cache service — dispatched by the IPC router when extensions
 * call `context.cache.get(key)` etc. The extensionId is injected by the
 * IPC router from the calling extension's context, so extensions never see
 * other extensions' data.
 */
export const extensionCacheService = {
  async get(extensionId: string, key: string): Promise<string | undefined> {
    const val = await extCacheGet(extensionId, key);
    return val ?? undefined;
  },

  async set(
    extension_id: string,
    key: string,
    value: string,
    options?: { expiresAt?: number }
  ): Promise<void> {
    return extCacheSet(extension_id, key, value, options?.expiresAt);
  },

  async delete(extension_Id: string, key: string): Promise<boolean> {
    return extCacheDelete(extension_Id, key);
  },

  async clear(extension_id: string): Promise<number> {
    return extCacheClear(extension_id);
  },
};
