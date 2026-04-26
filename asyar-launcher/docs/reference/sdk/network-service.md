### 8.4 `NetworkService` — Outbound HTTP requests

**Runs in:** both worker and view.

**Permission required:** `network`

```typescript
interface INetworkService {
  fetch(url: string, options?: RequestOptions): Promise<NetworkResponse>;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  body?: string;
  timeout?: number; // milliseconds, default 30000
}

interface NetworkResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;  // Always a string. Binary responses are base64-encoded.
  ok: boolean;   // true when status is 200-299
}
```

**Usage:**
```typescript
const network = context.getService<INetworkService>('network');

// GET request
const res = await network.fetch('https://api.example.com/data');
if (res.ok) {
  const data = JSON.parse(res.body);
}

// POST with JSON
const created = await network.fetch('https://api.example.com/items', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({ name: 'My Item', value: 42 }),
  timeout: 10_000,
});

// Handle errors
if (!created.ok) {
  throw new Error(`HTTP ${created.status}: ${created.statusText}`);
}
```

> ⚠️ **Never use `window.fetch()` or `XMLHttpRequest` directly inside your extension.** The iframe's Content Security Policy blocks all external requests (`default-src asyar-extension: 'self'`). Always route HTTP calls through `NetworkService`. Declare `"network"` in your `manifest.json` permissions.

**Timeout behaviour:** The `timeout` option (default 30 000 ms) controls how long the Rust backend waits for the remote server. The SDK adds an IPC-level timeout on top of this. The promise will always resolve or reject — it will never hang indefinitely.

---
