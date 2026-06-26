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
    extensionId: string,
    key: string,
    value: string,
    expiresAt?: number,
  ): Promise<void> {
    await extCacheSet(extensionId, key, value, expiresAt);
  },

  async delete(extensionId: string, key: string): Promise<boolean> {
    const result = await extCacheDelete(extensionId, key);
    if (result === null) throw new Error('ext_cache_delete failed');
    return result;
  },

  async clear(extensionId: string): Promise<number> {
    const result = await extCacheClear(extensionId);
    if (result === null) throw new Error('ext_cache_clear failed');
    return result;
  },
};
