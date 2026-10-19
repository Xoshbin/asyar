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
  secretRefs?: string[]; // Names declared in permissionArgs["network:secrets"]
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

### Local-network access

The ordinary `fetch()` method can reach a local device when the extension also
declares `network:lan`. Endpoint scopes may be declared in the manifest:

```json
{
  "permissions": ["network", "network:lan"],
  "permissionArgs": {
    "network:lan": ["speaker.local:1400", "192.168.0.0/16:1400"]
  }
}
```

No SDK method changes are needed. Rust resolves and pins the target, checks all
DNS answers against the declared host/CIDR and port, and repeats validation for
redirects. Loopback, link-local, and cloud metadata targets stay blocked.
The `permissionArgs["network:lan"]` entry is optional. Users can instead approve
endpoints in Settings → Extensions → Local network devices. HTTP and WebSocket
access to approved endpoints is included. Raw UDP/multicast discovery is not;
discovery is performed by the launcher, not by extensions.

Discovery reports the port a device serves HTTP on, not the control port it
advertises. A Sonos speaker appears on `:1400` (its SOAP/UPnP endpoint) rather
than the TLS `:1443` in its SRV record, and a Google Cast device appears on
`:8008` (the HTTP/DIAL API, for example `/setup/eureka_info`) rather than the
binary Cast socket on `:8009`, which closes the connection on an HTTP request.
Approving a device grants exactly the `host:port` shown in the scan, so an
endpoint approved before this translation existed still points at the old port
— remove it in Settings → Extensions → Local network devices, rescan, and
approve the device again.

#### List user-approved LAN devices

```typescript
const devices = await network.listLanDevices();
for (const device of devices) {
  await network.fetch(`http://${device.host}:${device.port}/status`);
}
```

`listLanDevices(): Promise<LanDevice[]>` requires `network:lan` and returns the
`{ host, port, label }` endpoints the user approved in Settings → Extensions →
Local network devices. Manifest `permissionArgs` entries are not included,
because the extension already owns its manifest. The method returns `[]` when
nothing has been approved. Extensions cannot trigger a LAN scan.

### Secret references

Declare `network` **and** `network:secrets`, with the reference definitions in
[`permissionArgs`](../manifest.md#secret-reference-schema). Then use the same
`fetch` API, passing reference names rather than tokens:

```typescript
const response = await network.fetch('https://api.example.com/api/usage', {
  secretRefs: ['cli-token'],
  timeout: 10_000,
});
if (response.status === 401) {
  // Show a sign-in instruction in your UI; do not try to refresh the token.
  throw new Error('Your login expired — sign in again with your CLI.');
}
```

- Rust reads the declared Keychain item or JSON file and injects the token into
  the declared header. The extension never receives the token itself.
- Only **HTTPS** and declared exact hosts are allowed: no wildcards or implicit
  subdomains. Hosts use their ASCII/punycode form; an optional `host:port` scopes
  a port. Optional `pathPrefixes` further restrict request paths.
- Methods default to `GET` only; other methods must be explicitly declared.
- Redirects are **not followed**, preventing forwarding to another destination.
- The response has the same `NetworkResponse` envelope as ordinary fetch, with
  secret redaction before it crosses the host boundary. Do not rely on redaction
  to hide partial or transformed token echoes (see the
  [threat model](../../explanation/permission-system.md#secret-references)).
- Secret-bearing responses are capped at **10 MiB**, and request timeouts at
  **30 seconds**. These restrictions do not change ordinary fetch behavior.
- Tokens are never refreshed or written by Asyar. Surface an expired token's
  **HTTP 401** so the user can re-log in with their CLI.
- WebSocket secret references are **unsupported**. `secretRefs` belongs only to
  HTTP `RequestOptions`.

Omitting `secretRefs`, or passing `[]`, uses ordinary `network:fetch` with no
secret injection. Existing extensions do not need to change.

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

> ⚠️ **Use `NetworkService` for reviewable, permission-scoped network access.**
> Direct browser networking is outside this Rust policy path; worker/view CSP
> hardening is tracked separately and should not be treated as an enforcement
> substitute. Declare `"network"` in your manifest and `"network:lan"` for
> scoped local HTTP endpoints.

**Timeout & Lifecycle behaviour:**

- **HTTP Fetch:** The `timeout` option (default 30 000 ms) controls how long the Rust backend waits for the remote server.
- **WebSocket Streaming:** Rust manages the background connection, socket lifecycles, and frame loops. Events are forwarded asynchronously to extension iframes via host push bridge without blocking UI render threads.
- **Role isolation:** A WebSocket belongs to the worker or view iframe that opened it. Its `onOpen`, `onMessage`, `onError`, and `onClose` callbacks are delivered only to that same role; they are never rerouted to the other iframe. If the originating iframe is unavailable, the event is dropped.

### SDK Playground role-isolation smoke test

In **SDK Playground → Network**, click **Run Worker WebSocket Probe**. It opens the displayed URL from the extension's worker iframe. A `role: worker` result with a `message` status confirms the worker received the callback. The result is intentionally mirrored through the extension-state service for display; it is not a WebSocket callback delivered to the view iframe.
