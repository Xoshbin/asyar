---
order: 3
---

# The IPC Bridge — How Service Calls Travel

Asyar runs every Tier 2 extension across **two iframes** — a `worker` and a
`view` — and every host service call traverses the same `postMessage` bridge
out of whichever iframe made the call. Each iframe owns its own
`ExtensionContext` + `MessageBroker` singleton; they do not share JS state.
Cross-iframe coordination goes through the launcher (the state broker and
the RPC primitive, both documented in [extension runtime](./extension-runtime.md)).

```
worker.html (hidden iframe)            view.html (on-demand iframe)
┌──────────────────────────┐           ┌──────────────────────────┐
│ ExtensionContext         │           │ ExtensionContext         │
│  (role: worker)          │           │  (role: view)            │
│ MessageBroker singleton  │           │ MessageBroker singleton  │
└─────────────┬────────────┘           └─────────────┬────────────┘
              │ window.parent.postMessage           │
              ▼                                     ▼
              ─── crosses iframe boundary ──────────
                              │
                              ▼
                   ExtensionIpcRouter (SvelteKit host)
                   ┌─────────────────────────────────┐
                   │ tap → protocolFilter →           │
                   │ preIdentityHandlers → identify → │
                   │ permissionGate → replyEnvelope → │
                   │ dispatch                         │
                   └────────────────┬─────────────────┘
                                    ▼
                   Rust command / launcher service
                                    │
                                    ▼
                   Response → event.source.postMessage(...)
```

## Host-side routing

### The stage pipeline

The router is an ordered list of stages plus a type→handler map, both exported
as data from
[`asyar-launcher/src/services/extension/ipc/`](../../asyar-launcher/src/services/extension/ipc/)
so tests can assert them directly:

| Stage                 | Responsibility                                                                          |
| --------------------- | --------------------------------------------------------------------------------------- |
| `tap`                 | Hands every frame — `asyar:` or not — to the search-response bridge                     |
| `protocolFilter`      | Drops non-`asyar:` frames, `asyar:response`, and response envelopes another bridge owns |
| `preIdentityHandlers` | Terminates frames that carry no identity claim (see below)                              |
| `identify`            | Resolves the caller's `extensionId` + `role`, then validates the manifest               |
| `permissionGate`      | Consults the Rust gate — **only** for `asyar:api:*`                                     |
| `replyEnvelope`       | Wraps dispatch: turns a throw into `{ error }` and reports the diagnostic               |
| `dispatch`            | Runs the terminal handler and posts `{ result }` if that handler replies                |

A stage that does not call `next()` ends the message there. Terminal handlers
live in `IPC_HANDLERS`, keyed by exact message type, and each one **declares**
whether it runs before identity (`beforeIdentity: true`) rather than depending
on where it sits in a chain. `asyar:window:hide`, `asyar:feedback:uncaught`,
and the `asyar:dev:*-log` frames declare it; `asyar:stream:abort` and
`asyar:extension:loaded` do not. Anything under `asyar:api:` with no exact
entry falls to the generic service-registry dispatch; any other `asyar:*` frame
gets an empty reply so the caller never hangs.

**`asyar:api:*` is the only permission-bearing surface.** Every other `asyar:`
frame is transport or lifecycle: it has no permission to declare, and the Rust
gate does not classify it — so running the (fail-closed) gate on one denies it.
A new non-api frame needs a handler, not a permission.

### Message Format

Everything sent across the bridge is shaped consistently by the SDK:

```typescript
{
  type: string,                // e.g., 'asyar:api:<prefix>:<method>'
  extensionId?: string,        // Mandatory for iframe callers
  payload: Record<string, unknown> | unknown[],
  messageId: string            // UUID for correlating async responses
}
```

### IPC Round-Trip Lifecycle

Scenario: extension code calls `context.proxies.log.info("Hello")` from the
**worker** iframe.

1. **SDK Proxy Intercept:** `LogServiceProxy` calls `this.broker.invoke('log:info', { message: "Hello" })`.
2. **PostMessage Dispatch:** `MessageBroker` prepends `'asyar:api:'` to form the type `asyar:api:log:info`, packages it alongside the payload, and calls `window.parent.postMessage(message, '*')`.
3. **Host Reception:** `ExtensionIpcRouter` has a global `window.addEventListener('message')` trap; each frame is run through the stage pipeline above.
4. **`protocolFilter` stage:** confirms the message type carries the `asyar:` prefix and is not itself a response.
5. **`identify` stage:** captures `event.source`. For a Tier 2 iframe (`source !== window`) it scans `iframe[data-extension-id]` elements for the one whose `contentWindow === source` and reads `data-extension-id` + `data-role` off that element. The identity is **never** taken from the message body — a payload-supplied `extensionId` would let any extension impersonate another. It then looks up the manifest via `getManifestById(extensionId)`; unknown → error reply and drop. Services that care which role made the call (state writes, action handler registration, RPC) read `role` off the dispatch context.
6. **`permissionGate` stage:** for `asyar:api:*` only, consults the fail-closed Rust gate. A denial replies with `{ error }` and stops.
7. **`dispatch` stage:** splits `asyar:api:log:info` into `['asyar', 'api', 'log', 'info']`, looks up `'log'` in the service registry, and applies `Object.values(payload)` as positional arguments to the target method.
8. **Tauri Invocation / Execution:** Native side effects fire (logging to stdout / file).
9. **Response Packaging:** the `replyEnvelope` / `dispatch` pair maps the result into `{ type: 'asyar:response', messageId, result }`, or a throw into `{ type: 'asyar:response', messageId, error }`.
10. **PostMessage Return:** `event.source.postMessage(response, '*')` — replies land in **the same iframe** that made the call. Two iframes from the same extension cannot accidentally receive each other's responses.
11. **Promise Resolution:** That iframe's `MessageBroker` matches `messageId` and resolves the awaiting promise.

### Role-aware iframe selection

Some host → iframe pushes (preferences, search requests, view-search keystrokes, push events) need to target a _specific_ role. The launcher uses the helper at [`asyar-launcher/src/services/extension/extensionIframeManager.svelte.ts`](../../asyar-launcher/src/services/extension/extensionIframeManager.svelte.ts):

```ts
function pickExtensionIframe(extensionId, prefer: 'view' | 'worker') {
  // Try the preferred role, then the other role, then any iframe with that
  // extension-id (legacy fallback).
  return document.querySelector(
    `iframe[data-extension-id="${extensionId}"][data-role="${prefer}"]`
  ) ?? /* fallback to other role */ /* fallback to unscoped */ ;
}
```

Push events (`asyar:event:*`) prefer the **worker** iframe — its always-on
lifecycle means subscribers stay current even when the user has dismissed
the launcher. The view iframe receives only the pushes it directly needs
(preferences, view-search keystrokes, keyboard forwarding).

### Built-in Extension IPC Emulation

Built-in (Tier 1) extensions heavily use the exact same `context.proxies...` SDK syntax. Because Tier 1 runs in the same context, `event.source === window`, and the router explicitly allows messages from `window` to pass the identity validation phase, ensuring the pipeline works equivalently for both tiers while keeping APIs standardized.

## view → worker RPC — `state:rpcRequest` / `state:rpcReply`

The view iframe is on-demand and DOM-bound; the worker iframe owns long-lived state. To let view code call worker handlers without plumbing a fresh listener per feature, the SDK ships a **launcher-brokered RPC primitive** (`extensionRpc`):

```
view iframe                        Launcher (state broker)              worker iframe
─────────────────────              ──────────────────────────           ──────────────────────
context.request('getStats', p)
  ├─ generates correlationId
  ├─ stores deferred (timeout=5000ms)
  └─ broker.invoke('state:rpcRequest',
       { id: 'getStats', correlationId, payload: p })
                       ─────────────────►
                                          IpcRouter: identity, permissions
                                          ExtensionStateService.rpcRequest()
                                            └─ WorkerMailbox.enqueue(envelope)
                                               then either:
                                                 - ReadyDeliverNow inline → asyar:action:execute
                                                 - or stores until ready_ack drains
                                                                     ─────────────────►
                                                                                          Worker RPC interceptor
                                                                                            (installed at module load)
                                                                                          extensionRpc.deliverActionPayload()
                                                                                            └─ handler(payload, signal)
                                                                                          broker.invoke('state:rpcReply',
                                                                                            { correlationId, result | error })
                                                                     ◄─────────────────
                                          IpcRouter resolves correlation
                                          posts asyar:action:execute reply envelope
                                          to the view iframe
                       ◄─────────────────
view: deferred resolves with result (or rejects on error / timeout / abort)
```

Key behaviours, all in the launcher's [`extension_state` Rust module](../../asyar-launcher/src-tauri/src/extensions/extension_state/):

- **Mailbox semantics.** If the worker is `Dormant`, the launcher mounts it on demand; `state:rpcRequest` envelopes wait in the worker mailbox and drain on the worker's `ready_ack`. The view-side `context.request(...)` promise just sees a slightly longer round-trip.
- **`ReadyDeliverNow` inline delivery.** When the worker is already `Ready`, the dispatch state machine returns `ReadyDeliverNow { messages }`, and the launcher delivers the RPC envelope as an `asyar:action:execute` message immediately — no second round-trip.
- **Correlation IDs.** Each `context.request(...)` call generates a UUID. The reply is matched and delivered to the view iframe; replies with no matching correlation are dropped silently (a late reply after `AbortSignal` fires).
- **AbortSignal + timeout.** Default timeout is 5000 ms (overridable via `opts.timeoutMs`). On view-side timeout / abort, the SDK posts `state:rpcAbort` with the same `correlationId`; the worker-side dispatcher fires the handler's `AbortSignal`. Handlers that ignore the signal still cause a leak — but a detectable one: the late reply is silently dropped.
- **Worker-only registration.** `context.onRequest(id, handler)` is only available on the worker `ExtensionContext`. Calling `context.request(...)` from the worker against itself is forbidden.

For the underlying mailbox + lifecycle state machine, see [extension runtime](./extension-runtime.md).

## Preferences delivery — `asyar:event:preferences:set-all`

Declarative extension preferences (see [Preferences](../reference/sdk/preferences.md)) need to reach the live `ExtensionContext` inside each extension iframe both at boot and whenever the user edits a value in the Settings window. This is a **host → extension** push with no response — the extension doesn't acknowledge, it just updates its frozen `context.preferences` snapshot and fires any registered `onPreferencesChanged` listeners.

### Why the message type lives under `asyar:event:*`

The SDK's `MessageBroker` inside the iframe only dispatches messages to registered listeners when the type begins with one of three prefixes:

| Prefix           | Purpose                                                             |
| ---------------- | ------------------------------------------------------------------- |
| `asyar:response` | Resolves a pending `invoke()` request by `messageId`                |
| `asyar:event:*`  | Fires all listeners registered via `broker.on('asyar:event:…', cb)` |
| `asyar:invoke:*` | Host calling an extension-provided function                         |

Anything else is silently dropped. The preferences listener is registered via `broker.on('asyar:event:preferences:set-all', …)`, so the host MUST post with that exact type. A plain `asyar:preferences:set-all` would land in the iframe, match no branch in `handleMessage`, and vanish.

### Protocol overview

```
                     Settings window / Main launcher window            Tier 2 iframe (worker or view)
                     ────────────────────────────────────              ──────────────────────────────
User edits
  focusMinutes ────► extensionPreferencesService.set(…)
                       │
                       │ IPC: invoke('extension_preferences_set', …)
                       ▼
                     Rust: storage::extension_preferences::set
                       │ encrypt if password type
                       │ SQLite UPSERT
                       │ app_handle.emit('asyar:preferences-changed', { extensionId })
                       ▼
                     Tauri broadcasts to ALL webviews
                       │
                       ├──► Settings window listener:
                       │      preferencesVersion++ → ExtensionDetailPanel re-fetches
                       │
                       └──► Main launcher listener (extensionManager.init):
                              extensionPreferencesService.invalidateCache(id)
                              handlePreferencesChanged(id):
                                getEffectivePreferences(id) → bundle
                                if Tier 1: reloadExtensions()
                                if Tier 2: extensionIframeManager.sendPreferencesToExtension(id, bundle)
                                             │
                                             │ iframe.contentWindow.postMessage(
                                             │   { type: 'asyar:event:preferences:set-all',
                                             │     payload: { extension, commands } },
                                             │   '*'  // WKWebView custom-scheme origin fix
                                             │ )
                                             └──────────────────────────────►
                                                                           │
                                                                   MessageBroker.handleMessage
                                                                           │
                                                                   routes asyar:event:* → listeners
                                                                           │
                                                                   ExtensionBridge listener:
                                                                     for each activeContext:
                                                                       context.setPreferences(bundle)
                                                                         └─ installs new frozen snapshot
                                                                         └─ fires onPreferencesChanged()
                                                                           │
                                                                   Engine listener recomputes,
                                                                   broadcasts to UI subscribers.
```

### Boot delivery via `asyar:extension:loaded`

Both iframes — worker and view — post `{ type: 'asyar:extension:loaded', extensionId, role }` once their `ExtensionContext` is wired. It is a lifecycle frame, not an `asyar:api:*` call, so it has its own entry in `IPC_HANDLERS`: identity and manifest are still required, but the permission gate is never consulted. The host treats it as the runtime ready-ack for that role's lifecycle state machine (see [extension runtime](./extension-runtime.md)) and replies with the initial preferences bundle to the iframe that posted it:

```
iframe main.ts                          ExtensionIpcRouter
─────────────────                       ──────────────────
postMessage({ type: 'asyar:extension:loaded', extensionId }, '*')
                    ──────────────────►
                                        identify: manifest validated
                                        permissionGate: skipped (not asyar:api:*)
                                        extensionPreferencesService.getEffectivePreferences(extensionId)
                                        postMessage({
                                          type: 'asyar:event:preferences:set-all',
                                          payload: { extension, commands },
                                        }, '*')
                    ◄──────────────────
ExtensionBridge listener fires
  → context.setPreferences(bundle)
```

### Context self-registration and the `__pending__` race guard

Tier 2 iframes bootstrap by creating a context directly and calling `setExtensionId`:

```ts
const context = new ExtensionContext();
context.setExtensionId(extensionId);
```

Under the hood, `setExtensionId` also calls `bridge.registerActiveContext(id, this)`, which stores the context in the bridge's `activeContexts` map. Without this step, the preferences listener (which iterates `activeContexts` to find live contexts) would find nothing and drop the bundle.

There's a race between the iframe posting `asyar:extension:loaded` (async) and the reply arriving. If the reply lands **before** any context has registered, the listener stashes the bundle under a `__pending__` sentinel key. When `registerActiveContext` runs later, it drains the sentinel and delivers the bundle immediately — so late-joining contexts always see the latest snapshot.

The Tier 1 code path (`ExtensionBridge.initializeExtensions()`) also goes through `setExtensionId`, so both tiers converge on the same self-registration logic.

### `targetOrigin` is `'*'` for host → iframe on macOS/Linux

WKWebView (macOS) and WebKitGTK (Linux) treat the `asyar-extension://` custom scheme as an **opaque origin**, which serializes as the literal string `"null"`. A strict `postMessage(msg, 'asyar-extension://…')` call would compare the target origin to `"null"` and silently drop the message with "Recipient has origin null."

The host uses `'*'` for host → iframe messages instead. This is safe because:

- `targetOrigin` is not the security boundary — the iframe `sandbox="allow-scripts allow-same-origin ..."` attribute, the custom scheme isolation, and the `ExtensionIpcRouter` permission gate are.
- The iframe → host direction already uses `'*'` via `MessageBroker.send` — host → iframe being symmetric is the consistent choice.

On Windows, Tauri serves every extension iframe from a shared `http://asyar-extension.localhost` origin (standard `http://` — not opaque), so the strict origin check is kept there as defense-in-depth.

See `src/lib/ipc/extensionOrigin.ts` in the launcher for the implementation.

---

## OAuth deferred-result IPC — `asyar:oauth:result`

`OAuthService.authorize()` uses a **deferred-result pattern**: the IPC response and the actual token arrive on two separate channels, because authorizing in a browser is an asynchronous human action that can take seconds or minutes.

### Protocol overview

```
Extension iframe                        Host (SvelteKit + Rust)
──────────────────────────────────────────────────────────────────────────
1. SDK generates flowId (UUID)
2. addEventListener('message', …)      ← registered BEFORE invoke
3. broker.invoke('oauth:authorize',
     { providerId, clientId, …, flowId })
                                       ─────────────────────────────────►
                                       4. IpcRouter: permission check (oauth:use)
                                       5. ExtensionOAuthService.authorize()
                                          FAST PATH (cached token):
                                            return OAuthToken in IPC response → done
                                          SLOW PATH (no cache):
                                            Rust: PKCE pair + state → auth URL
                                            openUrl(authUrl) → system browser
                                            return { pending: true }
                                       ◄─────────────────────────────────
6. invoke() resolves with token (fast) or { pending: true } (slow)
   slow path: SDK listener stays active…

   [User authorizes in browser — may take seconds or minutes]
   Provider → asyar://oauth/callback?code=X&state=Y
                                       Tauri deep-link → 'asyar:deep-link' event
                                       _handleCallback():
                                         Rust: HTTP POST token exchange
                                         AES-256-GCM encrypt → SQLite
                                       ◄─────────────────────────────────
{ type: 'asyar:oauth:result', flowId, token }    (push, no response expected)
    (or)
{ type: 'asyar:oauth:result', flowId, error: { code, message } }

7. window listener fires
8. flowId matches → authorize() Promise resolves or rejects
9. listener is removed
```

### Why the listener is registered before `invoke()`

Same reason as streaming: in theory a cached token could be returned synchronously in the IPC response before the `invoke()` promise resolves. Registering the `window.addEventListener` handler before the call ensures the extension never misses the result regardless of timing.

### `flowId` prevents cross-flow contamination

Each `authorize()` call generates a unique `flowId`. The window listener ignores any `asyar:oauth:result` message whose `flowId` doesn't match — so two concurrent `authorize()` calls (e.g. two different providers) resolve independently and correctly.

### Message shapes

```typescript
// Host → Extension (push after deep-link callback — no IPC response)
{
  type: 'asyar:oauth:result';
  flowId: string;
  token: OAuthToken;
}
{
  type: 'asyar:oauth:result';
  flowId: string;
  error: {
    code: string;
    message: string;
  }
}
```

---

## Timeouts

Every service call is asynchronous. There is no synchronous IPC. The `MessageBroker` has a default IPC timeout of 10 seconds — any call that takes longer than the timeout (plus the backend's own timeout) rejects with `"IPC Request timed out"`.

Streaming calls use a longer timeout (30 seconds) for the initial `invoke()` that starts the stream, since some providers have a slow time-to-first-token. The stream itself has no timeout — it runs until `done`, `error`, or `abort`.

---

See also: [Two-tier model](./two-tier-model.md) · [Extension runtime](./extension-runtime.md) · [Permission system](./permission-system.md)
