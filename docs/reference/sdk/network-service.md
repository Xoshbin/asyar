### 8.4 `NetworkService` — Outbound HTTP requests & WebSocket streaming

**Runs in:** both worker and view (note: `requestLanDevice` and `requestLanHost` require user interaction and must be called from a view; calling them from a worker rejects with `LAN_PICKER_REQUIRES_VIEW`).

**Permission required:** `network` (`network:lan` for local network access and device discovery)

```typescript
interface INetworkService {
  fetch(url: string, options?: RequestOptions): Promise<NetworkResponse>;
  connectWebSocket(url: string, options?: WebSocketOptions): Promise<IWebSocketHandle>;
  listLanDevices(): Promise<LanDevice[]>;
  requestLanDevice(options?: RequestLanDeviceOptions): Promise<LanDevice | null>;
  requestLanHost(target: RequestLanHostTarget): Promise<LanDevice | null>;
}

interface LanDevice {
  host: string;
  port: number;
  label: string;
}

interface RequestLanDeviceOptions {
  serviceTypes?: string[];
  reason?: string;
  allowManualEntry?: boolean;
}

interface RequestLanHostTarget {
  host: string;
  port: number;
  label?: string;
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

No SDK method changes are needed for `fetch()` or `connectWebSocket()`. Rust
resolves and pins the target, checks all DNS answers against the declared
host/CIDR and port, and repeats validation for redirects. Loopback, link-local,
and cloud metadata targets stay blocked.

> **Deprecated, removed in 0.2.0:** extensions that don't declare `network:lan`
> can still `fetch()` a **hostname** that resolves to a private or Tailscale
> address (for example a self-hosted server URL a user typed in), and Asyar logs
> a deprecation warning. Private IP literals are blocked as before. From 0.2.0
> these requests require `network:lan`, so add it now if your extension talks to
> self-hosted or home-network services.

The `permissionArgs["network:lan"]` entry is optional. Endpoints can be approved
in three ways:

1. **Pre-declared in manifest**: Defined in `permissionArgs["network:lan"]` at install time.
2. **In-flow device picker**: Requested dynamically via `network.requestLanDevice()`.
3. **In-flow direct host confirmation**: Requested dynamically via `network.requestLanHost()`.
4. **Settings UI**: Managed by the user in Settings → Extensions → Local network devices.

Discovery reports the port a device serves HTTP on, not the control port it
advertises. For example, a Sonos speaker appears on `:1400` (its SOAP/UPnP
endpoint) rather than the TLS `:1443` in its SRV record, and a Google Cast
device appears on `:8008` (the HTTP/DIAL API) rather than the binary Cast socket
on `:8009`. Approving a device grants exactly the `host:port` shown in the scan.

#### Request a LAN device (in-flow picker)

`requestLanDevice(options?: RequestLanDeviceOptions): Promise<LanDevice | null>`
prompts the user with a native launcher modal to discover and pick a device on
the local network:

```typescript
// Open the in-flow device picker
const device = await network.requestLanDevice({
  reason: 'Select your smart speaker to control playback',
  serviceTypes: ['_sonos._tcp.local.', '_googlecast._tcp.local.'], // optional custom types
  allowManualEntry: true, // allow manual IP & port entry tab (default true)
});

if (device) {
  console.log(`Approved: ${device.label} at ${device.host}:${device.port}`);
  const res = await network.fetch(`http://${device.host}:${device.port}/status`);
} else {
  console.log('User dismissed the picker');
}
```

- **Interactive UI**: Must be called from an extension view (`role: 'view'`).
  Calling it from a worker iframe rejects with `LAN_PICKER_REQUIRES_VIEW`.
- **Universal Discovery**: Runs 3-phase mDNS discovery (seed presets + any
  custom `serviceTypes` + dynamic DNS-SD service enumeration via
  `_services._dns-sd._udp.local.`) alongside wildcard SSDP (`ssdp:all`).
- **Manual Tab**: Includes a manual IP & port entry tab so users can enter
  devices on separate subnets or VLANs where multicast traffic is restricted.
- **Grant Persistence**: Once selected, the device's `host:port` is persisted in
  the extension's approved LAN hosts and returned as `{ host, port, label }`.
  Returns `null` if the user cancels or closes the dialog.

#### Request a custom LAN host (direct confirmation)

`requestLanHost(target: RequestLanHostTarget): Promise<LanDevice | null>` prompts
the user to approve a specific host and port without opening a full scan sheet:

```typescript
const approved = await network.requestLanHost({
  host: '192.168.1.50',
  port: 8123,
  label: 'Home Assistant',
});

if (approved) {
  const socket = await network.connectWebSocket(
    `ws://${approved.host}:${approved.port}/api/websocket`,
  );
}
```

- **SSRF Validation**: Rust pre-validates `host` and `port` against SSRF rules
  before showing the confirmation dialog. Loopback (`127.0.0.1`, `::1`),
  link-local metadata (`169.254.169.254`), and invalid ports are rejected
  immediately before prompting.
- **Interactive UI**: Must be called from an extension view (`role: 'view'`).
  Calling it from a worker rejects with `LAN_PICKER_REQUIRES_VIEW`.

#### List user-approved LAN devices

```typescript
const devices = await network.listLanDevices();
for (const device of devices) {
  await network.fetch(`http://${device.host}:${device.port}/status`);
}
```

`listLanDevices(): Promise<LanDevice[]>` requires `network:lan` and returns the
`{ host, port, label }` endpoints the user approved via Settings or the in-flow
picker. Manifest `permissionArgs` entries are not included, because the extension
already owns its manifest. The method returns `[]` when nothing has been approved.

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
