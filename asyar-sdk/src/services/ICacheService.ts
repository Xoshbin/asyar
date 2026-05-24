/**
 * Options for setting a cache entry.
 */
export interface CacheSetOptions {
  /**
   * The expiration date of the cache entry.
   * If not provided, the entry will never expire.
   */
  expirationDate?: Date;
}

/**
 * General-purpose persistent cache for extensions with TTL support.
 * 
 * Each extension has its own isolated cache namespace. Data is persisted
 * across launcher restarts but is NOT synced to the cloud.
 */
export interface ICacheService {
  /**
   * Gets a value from the cache.
   * Returns undefined if the key is missing or has expired.
   * 
   * @param key The unique key for the cached item.
   */
  get(key: string): Promise<string | undefined>;

  /**
   * Sets a value in the cache with an optional expiration date.
   * 
   * @param key The unique key for the cached item.
   * @param value The value to store.
   * @param options Optional settings, including expiration date.
   */
  set(key: string, value: string, options?: CacheSetOptions): Promise<void>;

  /**
   * Removes a value from the cache.
   * 
   * @param key The unique key to remove.
   * @returns A promise that resolves to true if the item existed and was removed.
   */
  remove(key: string): Promise<boolean>;

  /**
   * Clears all cache entries for the current extension.
   */
  clear(): Promise<void>;
}
