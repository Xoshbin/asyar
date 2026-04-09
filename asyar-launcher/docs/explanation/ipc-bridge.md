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

## Timeouts

Every service call is asynchronous. There is no synchronous IPC. The `MessageBroker` has a default IPC timeout of 10 seconds — any call that takes longer than the timeout (plus the backend's own timeout) rejects with `"IPC Request timed out"`.

Streaming calls use a longer timeout (30 seconds) for the initial `invoke()` that starts the stream, since some providers have a slow time-to-first-token. The stream itself has no timeout — it runs until `done`, `error`, or `abort`.

---

See also: [Two-tier model](./two-tier-model.md) · [Permission system](./permission-system.md)
