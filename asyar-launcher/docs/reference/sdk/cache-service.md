### 8.23 `CacheService` — General-purpose persistent cache

**Permission required:** `cache:read` for reads, `cache:write` for writes.

The `CacheService` provides a per-extension isolated namespace for storing transient data that should eventually expire. Unlike `StorageService`, which is intended for permanent extension data, `CacheService` supports a Time-To-Live (TTL) for every entry.

```typescript
export interface CacheSetOptions {
  /**
   * The expiration date of the cache entry.
   * If not provided, the entry will never expire.
   */
  expirationDate?: Date;
}

export interface ICacheService {
  /**
   * Gets a value from the cache.
   * Returns undefined if the key is missing or has expired.
   */
  get(key: string): Promise<string | undefined>;

  /**
   * Sets a value in the cache with an optional expiration date.
   */
  set(key: string, value: string, options?: CacheSetOptions): Promise<void>;

  /**
   * Removes a value from the cache.
   * @returns true if the item existed and was removed.
   */
  remove(key: string): Promise<boolean>;

  /**
   * Clears all cache entries for the current extension.
   */
  clear(): Promise<void>;
}
```

**Usage:**

```typescript
const cache = context.getService<ICacheService>('CacheService');

// Cache an API response for 1 hour
const oneHourFromNow = new Date(Date.now() + 3600 * 1000);
await cache.set('api_data', JSON.stringify(data), { 
  expirationDate: oneHourFromNow 
});

// Read from cache
const cachedRaw = await cache.get('api_data');
if (cachedRaw) {
  const data = JSON.parse(cachedRaw);
}

// Key automatically becomes inaccessible after oneHourFromNow
// and will be pruned from the database on the next app restart.

// Manually remove a key
await cache.remove('api_data');

// Wipe the entire cache for this extension
await cache.clear();
```

**How it works under the hood:**

Caches are stored in a dedicated `extension_cache` SQLite table. Isolation is enforced by the Rust backend using your `extensionId`. 

- **Lazy Expiration:** When you call `get()`, the backend checks the `expires_at` column. If the timestamp has passed, the row is deleted and `get()` returns `null`.
- **Proactive Pruning:** On every launcher startup, Asyar runs a maintenance task to prune all expired entries across all extensions to keep the database slim.

**When to use Cache vs Storage:**

| Feature | `CacheService` | `StorageService` |
|---|---|---|
| **Persistence** | Permanent until expired | Permanent until deleted |
| **TTL Support** | Yes | No |
| **Cloud Sync** | No (Isolated to device) | Yes (Syncs across devices) |
| **Best For** | API data, search index snapshots | User content, history, notes |

---
