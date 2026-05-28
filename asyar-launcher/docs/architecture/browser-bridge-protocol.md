# Asyar Browser Bridge — Protocol Specification

> Version 1. Stable wire contract for browser-side companion extensions.

The Asyar launcher hosts a local HTTP + WebSocket server bound to `127.0.0.1`
on an OS-assigned port. Companion browser extensions discover the port, request
pairing, await user approval inside the launcher, then maintain a persistent
WebSocket connection authenticated by a token.

## 1. Discovery

```
GET http://127.0.0.1:<port>/discover
→ { "name": "asyar", "version": "<launcher version>" }
```

Probe a range (suggested 54300–54320, but the protocol does not mandate a range)
in parallel with short-timeout fetches. The first port returning a `name == "asyar"`
response is the running launcher. Cache the port in extension storage; retry
discovery if the cached port stops responding.

## 2. Pairing

```
POST http://127.0.0.1:<port>/pair-request
Body: { "family": "chromium" | "firefox" | "safari", "variant": "chrome" | "brave" | ... }
→ { "pairing_id": "<uuid>" }
```

The launcher displays a confirmation dialog. The companion long-polls for the
result:

```
GET http://127.0.0.1:<port>/pair-status/{pairing_id}
(blocks up to 60s)
→ { "status": "approved", "token": "<base64url, 43 chars>" }
| { "status": "denied" }
| { "status": "timed_out" }
| { "status": "unknown" }
```

Store the token in browser extension storage. Treat it as a long-lived secret —
do not transmit anywhere except the WebSocket Authorization header.

## 3. WebSocket connection

```
WS  ws://127.0.0.1:<port>/bridge?family=<family>&variant=<variant>
Header: Authorization: Bearer <token>
```

Send `hello` as the first message:

```json
{"type":"hello","version":1,"browser":{"family":"chromium","variant":"chrome","profiles":["Default","Profile 1"]}}
```

## 4. Message envelopes

### Companion → server

```ts
| { "type": "hello", "version": 1, "browser": { family, variant, profiles[] } }
| { "type": "event", "name": "tabs.snapshot" | "tabs.changed", "payload": Tab[] }
| { "type": "event", "name": "page.changed", "payload": { tabId: string, page: PageSnapshot } }
| { "type": "res", "id": string, "ok": true,  "result": any }
| { "type": "res", "id": string, "ok": false, "error": string }
```

### Server → companion

```ts
| { "type": "req", "id": string, "method": "tabs.activate" | "tabs.close" | "tabs.open", "params": any }
| { "type": "req", "id": string, "method": "page.snapshot" | "page.query" | "page.action", "params": any }
```

## 5. Tab shape

```ts
{
  id: string,                  // stable for the lifetime of this WS session
  browser: { family, variant, profileId },
  windowId: string,
  index: number,
  title: string,
  url: string,
  faviconUrl?: string,
  isActive: boolean,
  isPinned: boolean,
  isAudible: boolean,
  groupName?: string,
}
```

The companion is responsible for:
- Sending an initial `tabs.snapshot` after `hello`
- Sending `tabs.changed` whenever any tab is created, removed, navigated, activated,
  or moved between windows
- Including the full current tab list in every `tabs.changed` (no incremental diffs in v1)

## 6. Page shape

```ts
{
  url: string,
  title: string,
  readableText: string,
  html?: string,
  selection?: string,
  meta: {
    description?: string,
    ogImage?: string,
    lang?: string
  }
}
```

The companion is responsible for sending `page.changed` when the active tab's page content fundamentally changes (e.g., DOM mutations indicating a navigation or major update in an SPA).

### PageMatch shape (response to `page.query`)

```ts
{
  tag: string,                       // lowercase element tag, e.g. "a"
  attrs: Record<string, string>,     // all values MUST be strings
  textContent: string,
}
```

**Companion contract — stringification:** all `attrs` values are strings. If an
attribute's source value is numeric, boolean, or null, the companion stringifies
it before sending (`42` → `"42"`, `true` → `"true"`, `null` → `"null"` or omit
the key entirely — companion's choice). The launcher rejects non-string values
at deserialize time so a mis-behaving companion fails loudly rather than
corrupting downstream extension code.

### Optional `attrs` filter on `page.query`

When the request omits `attrs` (or sends `attrs: undefined`), the companion
returns its default set of attributes for each match (typically all standard
HTML attributes). When the request sends `attrs: [...]`, the companion returns
only those keys. An empty array `attrs: []` means "return no attribute keys".
These three states are distinct and the companion must honor them.

## 7. Server-initiated methods

| Method            | Params                            | Result                   |
|-------------------|-----------------------------------|--------------------------|
| `tabs.activate`   | `{ tabId: string }`               | `{ activated: true }`    |
| `tabs.close`      | `{ tabId: string }`               | `{ closed: true }`       |
| `tabs.open`       | `{ url: string, newWindow: bool }`| `{ tabId: string }`      |
| `page.snapshot`   | `{ tabId: string }`               | `PageSnapshot`           |
| `page.query`      | `{ tabId, selector, attrs? }`     | `PageMatch[]`            |
| `page.action`     | `{ tabId, action: { kind } }`     | `null`                   |

The companion is expected to respond within 5 seconds for tab methods, and 10 seconds for page methods. The launcher times out RPCs after these durations and returns an error to the calling extension.

## 8. Revocation

The user can revoke pairing in the launcher's Settings → Browsers UI. The
companion's next WS connect attempt will fail with HTTP 401. The companion
should detect 401 on `/bridge`, clear its stored token, and offer the user
the option to re-pair.

## 9. Security model

- Bridge listens on `127.0.0.1` only. Never bind to `0.0.0.0`.
- All connections authenticated by a per-browser token.
- The token is generated by the launcher using a CSPRNG (32 random bytes,
  base64url-encoded, 43 chars no padding).
- The token is stored:
  - Launcher side: OS keychain (macOS keychain / Linux secret-service / Windows credential manager)
  - Companion side: browser extension storage
- The user must approve pairing inside the launcher UI. The browser-side flow
  cannot complete pairing without the human acting on the launcher.

## 10. Versioning

The `version: 1` field in `hello` declares the protocol version the companion
speaks. Future protocol versions will add new event names or methods without
breaking v1 — the launcher inspects this field to decide which features to
expose.
