### 8.5 `SettingsService` — Persistent key-value storage

**Permission required:** None (namespaced to your extension's section).

```typescript
interface ISettingsService {
  get<T>(section: string, key: string): Promise<T>;
  set<T>(section: string, key: string, value: T): Promise<void>;
  onChanged<T>(section: string, callback: (settings: T) => void): () => void;
}
```

**Usage:**
```typescript
const settings = context.getService<ISettingsService>('settings');

// Read a setting (with TypeScript type inference)
const theme = await settings.get<string>('com.yourname.myext', 'theme');
const count = await settings.get<number>('com.yourname.myext', 'itemCount');

// Write a setting
await settings.set('com.yourname.myext', 'theme', 'dark');
await settings.set('com.yourname.myext', 'lastUsed', Date.now());

// Subscribe to changes (reactive — fires when value changes from any source)
const unsubscribe = settings.onChanged<{ theme: string }>(
  'com.yourname.myext',
  (newSettings) => {
    console.log('Theme changed to:', newSettings.theme);
  }
);

// Call the returned function to stop listening
unsubscribe();
```

> **Pro Tip:** Use `StorageService` (Section 8.12) for general-purpose data persistence — it's backed by SQLite and scoped to your extension. Use `SettingsService` when you need reactive change subscriptions or host-visible configuration. For transient local state within a session, `localStorage` works fine inside the iframe.

---
