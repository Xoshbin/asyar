### 8.4 `NetworkService` — Outbound HTTP requests & WebSocket streaming

**Runs in:** both worker and view.

**Permission required:** `network`

```typescript
interface INetworkService {
  fetch(url: string, options?: RequestOptions): Promise<NetworkResponse>;
  connectWebSocket(url: string, options?: WebSocketOptions): Promise<IWebSocketHandle>;
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
  body: string; // Always a string. Binary responses are base64-encoded.
  ok: boolean; // true when status is 200-299
}

interface WebSocketOptions {
  headers?: Record<string, string>;
}

interface IWebSocketHandle {
  readonly socketId: string;
  send(data: string): Promise<void>;
  close(code?: number, reason?: string): Promise<void>;
  onOpen(callback: () => void): () => void;
  onMessage(callback: (data: string) => void): () => void;
  onError(callback: (error: string) => void): () => void;
  onClose(callback: (info: { code?: number; reason?: string }) => void): () => void;
}
```

**HTTP Fetch Usage:**

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
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ name: 'My Item', value: 42 }),
  timeout: 10_000,
});

// Handle errors
if (!created.ok) {
  throw new Error(`HTTP ${created.status}: ${created.statusText}`);
}
```

**WebSocket Event Push Streaming Usage:**

```typescript
const network = context.getService<INetworkService>('network');

// Connect to a persistent WebSocket server (e.g. Home Assistant, live event stream)
const socket = await network.connectWebSocket('wss://homeassistant.local:8123/api/websocket');

socket.onOpen(() => {
  console.log('Connected to WebSocket server');
  socket.send(JSON.stringify({ type: 'auth', api_password: 'secret-token' }));
});

socket.onMessage((data) => {
  console.log('Received push frame:', data);
});

socket.onError((err) => {
  console.error('WebSocket error:', err);
});

socket.onClose(({ code, reason }) => {
  console.log(`Socket closed (${code ?? 'none'}): ${reason ?? 'none'}`);
});

// Send outgoing frame
await socket.send(JSON.stringify({ id: 1, type: 'subscribe_events', event_type: 'state_changed' }));

// Close explicitly when done
await socket.close(1000, 'User navigated away');
```

> ⚠️ **Never use `window.fetch()`, `XMLHttpRequest`, or `new WebSocket()` directly inside your extension.** The iframe's Content Security Policy blocks external network connections (`default-src asyar-extension: 'self'`). Always route HTTP and WebSocket calls through `NetworkService`. Declare `"network"` in your `manifest.json` permissions.

**Timeout & Lifecycle behaviour:**

- **HTTP Fetch:** The `timeout` option (default 30 000 ms) controls how long the Rust backend waits for the remote server.
- **WebSocket Streaming:** Rust manages the background connection, socket lifecycles, and frame loops. Events are forwarded asynchronously to extension iframes via host push bridge without blocking UI render threads.
- **Role isolation:** A WebSocket belongs to the worker or view iframe that opened it. Its `onOpen`, `onMessage`, `onError`, and `onClose` callbacks are delivered only to that same role; they are never rerouted to the other iframe. If the originating iframe is unavailable, the event is dropped.

### SDK Playground role-isolation smoke test

In **SDK Playground → Network**, click **Run Worker WebSocket Probe**. It opens the displayed URL from the extension's worker iframe. A `role: worker` result with a `message` status confirms the worker received the callback. The result is intentionally mirrored through the extension-state service for display; it is not a WebSocket callback delivered to the view iframe.
