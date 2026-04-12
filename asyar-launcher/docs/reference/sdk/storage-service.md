### 8.12 `StorageService` — Scoped key-value persistence

**Permission required:** `storage:read` for reads, `storage:write` for writes.

The recommended way to persist extension data across sessions. Each extension gets its own isolated namespace backed by SQLite on the Rust side — extensions cannot read or write other extensions' data.

```typescript
interface IStorageService {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<boolean>;
  getAll(): Promise<Record<string, string>>;
  clear(): Promise<number>;
}
```

**Usage:**
```typescript
const storage = context.getService<IStorageService>('StorageService');

// Store a value (values are strings — JSON.stringify complex data)
await storage.set('theme', 'dark');
await storage.set('bookmarks', JSON.stringify(['https://example.com']));

// Read a value
const theme = await storage.get('theme'); // "dark"
const raw = await storage.get('bookmarks');
const bookmarks = raw ? JSON.parse(raw) : [];

// Check if a key exists
const val = await storage.get('nonexistent'); // null

// Delete a single key
const wasDeleted = await storage.delete('theme'); // true

// Get everything
const all = await storage.getAll(); // { "bookmarks": "[\"https://example.com\"]" }

// Nuclear option — delete all your extension's data
const count = await storage.clear(); // number of deleted entries
```

**How it works under the hood:**

All extensions share one `extension_storage` table in `asyar_data.db` (SQLite, WAL mode). The IPC Router automatically injects your `extensionId` into every call — you never see it, and you cannot impersonate another extension. On uninstall, Asyar deletes all rows for your extension automatically.

**When to use what:**

| Need | Use |
|---|---|
| Persist data across sessions (user preferences, notes, stable state) | `StorageService` |
| Transient data with an expiration (API responses, search indexes) | `CacheService` |
| Transient state within a single session | `localStorage` (iframe-scoped, survives view navigation) |
| App-wide settings with reactive change subscriptions | `SettingsService` |

> **Pro Tip:** Values are plain strings. For objects and arrays, use `JSON.stringify`/`JSON.parse`. Keep keys short and descriptive — there's no size limit, but the entire table is shared across all extensions.

---
