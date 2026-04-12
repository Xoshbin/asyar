---
order: 3
---
# The IPC Bridge — How Service Calls Travel

```
Extension Component (.svelte)
        │
        │ calls service method
        ▼
ServiceProxy (e.g. NotificationServiceProxy)
        │
        │ MessageBroker.invoke('asyar:api:notification:notify', payload)
        ▼
window.parent.postMessage(message, '*')
        │
        │ ─── crosses iframe boundary ───────────────────────────────
        ▼
ExtensionIpcRouter (SvelteKit host)
        │
        │ 1. Permission check — is this callType declared in manifest.json?
        │ 2. Route to correct Tauri command
        ▼
Tauri Rust Command (src-tauri/src/commands/)
        │
        │ executes the operation
        ▼
Response back through postMessage
        │
        │ ─── crosses iframe boundary ───────────────────────────────
        ▼
MessageBroker (promise resolves)
        │
        ▼
ServiceProxy returns value to caller
```

## Host-side routing

When a sandbox (Tier 2) extension requests Host-level APIs, it relies on the `postMessage` IPC boundary. 

### Message Format
Everything sent across the pipeline is shaped consistently by the `asyar-sdk`:
```typescript
{
  type: string,                // e.g., 'asyar:api:invoke' or 'asyar:api:<prefix>:<method>' 
  extensionId?: string,        // Mandatory for iframe callers
  payload: Record<string, unknown> | any[], 
  messageId: string            // UUID representing the call for correlating async responses
}
```

### IPC Round-Trip Lifecycle
Scenario: Extension invokes `context.proxies.LogService.info("Hello")`

1. **SDK Proxy Intercept:** The `LogServiceProxy` internally calls `this.broker.invoke('log:info', { message: "Hello" })`.
2. **PostMessage Dispatch:** `MessageBroker` prepends `'asyar:api:'` to form the type `asyar:api:log:info`, packages it alongside the payload, and calls `window.parent.postMessage(message, '*')`.
3. **Host Reception:** `extensionManager.ts` has a global `window.addEventListener('message')` trap (`setupIpcHandler()`).
4. **Source Validation Phase:**
   - The handler confirms the msg type conforms to the `asyar:` prefix.
   - It captures `event.source`. If `source !== window` (i.e. it came from the Iframe sandbox), it enforces that `extensionId` is provided in the message.
5. **Security Gate:** Looks up the `manifest` using `getManifestById(extensionId)`. If unauthorized or unknown, the message drops.
6. **Host Service Dispatch:** Utilizing the split format `['asyar', 'api', 'log', 'info']`, the handler maps the shortname `'log'` through a `serviceMap` (e.g. `'log' -> 'LogService'`) to find the correct local `LogService` instance. It then extracts the object payload values via `Object.values(payload)` (yielding `["Hello"]`) and applies them as function arguments to the target method (`info`).
7. **Tauri Invocation / Execution:** Native side effects trigger (e.g., logging to stdout or file).
8. **Response Packaging:** The host maps the result into `{ type: 'asyar:response', messageId, result, success: true }`.
9. **PostMessage Return:** `event.source.postMessage(response, '*')`.
10. **Promise Resolution:** The `MessageBroker` living inside the iframe receives the response, matches the `messageId`, and resolves the awaited promise back to the SDK caller.

### Built-in Extension IPC Emulation
Built-in (Tier 1) extensions heavily use the exact same `context.proxies...` SDK syntax. Because Tier 1 runs in the same context `event.source === window`, `ExtensionManager` explicitly allows messages from the `window` to pass the identity validation phase check entirely ensuring the pipeline works equivalently for both modes while keeping APIs standardized.

## Streaming IPC — `asyar:stream:*`

Most service calls are request/response: one `postMessage` out, one `postMessage` back. **AI streaming** breaks this pattern — tokens arrive continuously as the provider yields them, which doesn't fit a single response envelope.

The `asyar:stream:*` message family handles this. It is currently used only by `AIService`, but it is a generic primitive that any future streaming service can reuse.

### Protocol overview

```
Extension iframe                        Host (SvelteKit)
──────────────────────────────────────────────────────────────
1. SDK generates streamId
2. addEventListener('message', …)  ← registers BEFORE invoke
3. broker.invoke('asyar:service:AIService:streamChat', { streamId, messages, … })
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
                     Settings window / Main launcher window            Pomodoro iframe
                     ────────────────────────────────────              ──────────────────
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

When a Tier 2 iframe finishes bootstrapping, it posts `{ type: 'asyar:extension:loaded', extensionId }` to signal readiness. The router handles this at the **top level** of its message switch (it is NOT an `asyar:api:*` call and was hoisted out of that branch) and replies with the initial preferences bundle:

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
3. broker.invoke('asyar:service:OAuthService:authorize',
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

See also: [Two-tier model](./two-tier-model.md) · [Permission system](./permission-system.md)
