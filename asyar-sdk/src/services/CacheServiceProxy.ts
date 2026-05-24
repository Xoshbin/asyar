import { ICacheService, CacheSetOptions } from './ICacheService';
import { BaseServiceProxy } from './BaseServiceProxy';

/**
 * SDK-side proxy for the Cache Service.
 * 
 * Communicates with the Launcher Host via asyar:api:cache:* IPC messages.
 * Each extension has an isolated namespace in the backend.
 */
export class CacheServiceProxy extends BaseServiceProxy implements ICacheService {
  /**
   * Gets a value from the cache.
   */
  async get(key: string): Promise<string | undefined> {
    const value = await this.broker.invoke<string | null>('cache:get', {
      key,
    });
    return value ?? undefined;
  }

  /**
   * Sets a value in the cache with an optional expiration date.
   */
  async set(key: string, value: string, options?: CacheSetOptions): Promise<void> {
    const expiresAt = options?.expirationDate 
      ? Math.floor(options.expirationDate.getTime() / 1000) 
      : undefined;

    return this.broker.invoke('cache:set', {
      key,
      value,
      expiresAt,
    });
  }

  /**
   * Removes a value from the cache.
   */
  async remove(key: string): Promise<boolean> {
    return this.broker.invoke<boolean>('cache:delete', {
      key,
    });
  }

  /**
   * Clears all cache entries for the current extension.
   */
  async clear(): Promise<void> {
    return this.broker.invoke('cache:clear', {});
  }
}
