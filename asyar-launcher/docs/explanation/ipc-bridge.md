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
                   │ 1. Identity gate                 │
                   │    - findIframeRoleForSource()   │
                   │      maps event.source → role    │
                   │      via data-role="…"           │
                   │ 2. Permission check              │
                   │ 3. Service registry dispatch     │
                   └────────────────┬─────────────────┘
                                    ▼
                   Rust command / launcher service
                                    │
                                    ▼
                   Response → event.source.postMessage(...)
```

## Host-side routing

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
3. **Host Reception:** `ExtensionIpcRouter` has a global `window.addEventListener('message')` trap.
4. **Source Validation Phase:**
   - The handler confirms the message type conforms to the `asyar:` prefix.
   - It captures `event.source`. If `source !== window` (i.e. came from a Tier 2 iframe), it enforces that `extensionId` is provided in the message.
   - It calls `findIframeRoleForSource(event.source)` which scans `iframe[data-extension-id]` elements and returns whichever has its `contentWindow === source` — yielding a `role: 'view' | 'worker' | undefined` on the dispatched call. Services that care which role made the call (state writes, action handler registration, RPC) read this off the dispatch context.
5. **Security Gate:** Looks up the manifest via `getManifestById(extensionId)`. Unauthorized or unknown → drop.
6. **Host Service Dispatch:** Splits `asyar:api:log:info` into `['asyar', 'api', 'log', 'info']`, looks up `'log'` in the service registry, and applies `Object.values(payload)` as positional arguments to the target method.
7. **Tauri Invocation / Execution:** Native side effects fire (logging to stdout / file).
8. **Response Packaging:** Host maps the result into `{ type: 'asyar:response', messageId, result, success: true }`.
9. **PostMessage Return:** `event.source.postMessage(response, '*')` — replies land in **the same iframe** that made the call. Two iframes from the same extension cannot accidentally receive each other's responses.
10. **Promise Resolution:** That iframe's `MessageBroker` matches `messageId` and resolves the awaiting promise.

### Role-aware iframe selection

Some host → iframe pushes (preferences, search requests, view-search keystrokes, push events) need to target a *specific* role. The launcher uses the helper at [`asyar-launcher/src/services/extension/extensionIframeManager.svelte.ts`](../../../asyar-launcher/src/services/extension/extensionIframeManager.svelte.ts):

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

Key behaviours, all in the launcher's [`extension_state` Rust module](../../../asyar-launcher/src-tauri/src/extensions/extension_state/):

- **Mailbox semantics.** If the worker is `Dormant`, the launcher mounts it on demand; `state:rpcRequest` envelopes wait in the worker mailbox and drain on the worker's `ready_ack`. The view-side `context.request(...)` promise just sees a slightly longer round-trip.
- **`ReadyDeliverNow` inline delivery.** When the worker is already `Ready`, the dispatch state machine returns `ReadyDeliverNow { messages }`, and the launcher delivers the RPC envelope as an `asyar:action:execute` message immediately — no second round-trip.
- **Correlation IDs.** Each `context.request(...)` call generates a UUID. The reply is matched and delivered to the view iframe; replies with no matching correlation are dropped silently (a late reply after `AbortSignal` fires).
- **AbortSignal + timeout.** Default timeout is 5000 ms (overridable via `opts.timeoutMs`). On view-side timeout / abort, the SDK posts `state:rpcAbort` with the same `correlationId`; the worker-side dispatcher fires the handler's `AbortSignal`. Handlers that ignore the signal still cause a leak — but a detectable one: the late reply is silently dropped.
- **Worker-only registration.** `context.onRequest(id, handler)` is only available on the worker `ExtensionContext`. Calling `context.request(...)` from the worker against itself is forbidden.

For the underlying mailbox + lifecycle state machine, see [extension runtime](./extension-runtime.md).

## Streaming IPC — `asyar:stream:*`

Most service calls are request/response: one `postMessage` out, one `postMessage` back. **AI streaming** breaks this pattern — tokens arrive continuously as the provider yields them, which doesn't fit a single response envelope.

The `asyar:stream:*` message family handles this. It is currently used only by `AIService`, but it is a generic primitive that any future streaming service can reuse.

### Protocol overview

```
Extension iframe                        Host (SvelteKit)
──────────────────────────────────────────────────────────────
1. SDK generates streamId
2. addEventListener('message', …)  ← registers BEFORE invoke
3. broker.invoke('ai:streamChat', { streamId, messages, … })
                                   ──────────────────────────►
                                   4. IpcRouter permission check
                                   5. AIService validates toggle + config
                                   6. StreamDispatcher.create(extensionId, streamId)
                                   7. engineStreamChat(…) — NOT awaited (fire-and-forget)
                                   8. returns { streaming: true }
                                   ◄──────────────────────────
9. invoke() promise resolves { streaming: true }

                                   [tokens arrive from provider]
                                   ◄──────────────────────────
{ type: 'asyar:stream', streamId, phase: 'chunk', data: { token } }
{ type: 'asyar:stream', streamId, phase: 'chunk', data: { token } }
…
{ type: 'asyar:stream', streamId, phase: 'done' }
                            (or)
{ type: 'asyar:stream', streamId, phase: 'error', error: { code, message } }

── abort path (extension-initiated) ──────────────────────────
handle.abort() posts:
{ type: 'asyar:stream:abort', streamId }
                                   ──────────────────────────►
                                   IpcRouter intercepts BEFORE dispatch
                                   StreamDispatcher.abort(streamId)
                                   → AbortController signals fetch cancellation
```

### Why the listener is registered before `invoke()`

The `asyar:stream` chunk messages start flowing as soon as the engine yields its first token, which can happen before the `invoke()` promise resolves. Registering the `window.addEventListener('message', …)` handler synchronously before calling `broker.invoke()` ensures no tokens are missed regardless of engine latency.

### `asyar:stream:abort` is intercepted before dispatch

The `ExtensionIpcRouter` handles `type === 'asyar:stream:abort'` as a special case before the normal service-dispatch path. This avoids the overhead of permission checks and service lookup for what is effectively a control signal.

### Message shapes

```typescript
// Host → Extension (unilateral, no response expected)
{ type: 'asyar:stream'; streamId: string; phase: 'chunk'; data: { token: string } }
{ type: 'asyar:stream'; streamId: string; phase: 'done' }
{ type: 'asyar:stream'; streamId: string; phase: 'error'; error: { code: string; message: string } }

// Extension → Host (abort signal, no response)
{ type: 'asyar:stream:abort'; streamId: string }
```

## Preferences delivery — `asyar:event:preferences:set-all`

Declarative extension preferences (see [Preferences](../reference/sdk/preferences.md)) need to reach the live `ExtensionContext` inside each extension iframe both at boot and whenever the user edits a value in the Settings window. This is a **host → extension** push with no response — the extension doesn't acknowledge, it just updates its frozen `context.preferences` snapshot and fires any registered `onPreferencesChanged` listeners.

### Why the message type lives under `asyar:event:*`

The SDK's `MessageBroker` inside the iframe only dispatches messages to registered listeners when the type begins with one of three prefixes:

| Prefix | Purpose |
|---|---|
| `asyar:response` | Resolves a pending `invoke()` request by `messageId` |
| `asyar:event:*` | Fires all listeners registered via `broker.on('asyar:event:…', cb)` |
| `asyar:invoke:*` | Host calling an extension-provided function |

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

Both iframes — worker and view — post `{ type: 'asyar:extension:loaded', extensionId, role }` once their `ExtensionContext` is wired. The router handles this at the **top level** of its message switch (it is NOT an `asyar:api:*` call and was hoisted out of that branch). The host treats it as the runtime ready-ack for that role's lifecycle state machine (see [extension runtime](./extension-runtime.md)) and replies with the initial preferences bundle to the iframe that posted it:

```
iframe main.ts                          ExtensionIpcRouter
─────────────────                       ──────────────────
postMessage({ type: 'asyar:extension:loaded', extensionId }, '*')
                    ──────────────────►
                                        manifest / permission validation
                                        (both pass — asyar:extension:loaded is a core call)
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
{ type: 'asyar:oauth:result'; flowId: string; token: OAuthToken }
{ type: 'asyar:oauth:result'; flowId: string; error: { code: string; message: string } }
```

---

## Timeouts

Every service call is asynchronous. There is no synchronous IPC. The `MessageBroker` has a default IPC timeout of 10 seconds — any call that takes longer than the timeout (plus the backend's own timeout) rejects with `"IPC Request timed out"`.

Streaming calls use a longer timeout (30 seconds) for the initial `invoke()` that starts the stream, since some providers have a slow time-to-first-token. The stream itself has no timeout — it runs until `done`, `error`, or `abort`.

---

See also: [Two-tier model](./two-tier-model.md) · [Extension runtime](./extension-runtime.md) · [Permission system](./permission-system.md)
