---
name: review-ipc
description: Audit IPC message contracts between extensions and the Asyar host. Use when adding a new SDK service, adding a new proxy method, changing a postMessage type string, or reviewing permission gate coverage.
allowed-tools: Read, Grep, Glob
---

# review-ipc

Audit the IPC layer across the SDK, permission gate, and host listener for correctness and completeness.

## Context: the worker/view bridge

Every Tier 2 extension runs in **two iframes** — a worker (always-on,
hidden, `worker.html`) and a view (on-demand, `view.html`). Each iframe
imports from a different SDK entry (`asyar-sdk/worker` vs
`asyar-sdk/view`) and owns its own `MessageBroker` and
`ExtensionContext`. The IPC bridge audited here therefore covers
**both** iframes' calls into the host. `ExtensionIpcRouter` maps
`event.source` back to a role via `findIframeRoleForSource(...)` —
services that branch on role read it off the dispatch context.

For the runtime details (state machine, mailbox, RPC), see
[`docs/explanation/extension-runtime.md`](../../../docs/explanation/extension-runtime.md);
for the per-message protocol, see
[`docs/explanation/ipc-bridge.md`](../../../docs/explanation/ipc-bridge.md).

## What to check

### 1. Type string format consistency

All SDK proxy methods must call `broker.invoke('{service}:{action}', ...)`. The `MessageBroker` prepends `asyar:api:` automatically, producing `asyar:api:{service}:{action}`. Verify:

- Every `this.broker.invoke(...)` call in `asyar-sdk/src/services/*Proxy.ts` uses the `{service}:{action}` format (no `asyar:api:` prefix — that's added by MessageBroker)
- The resulting full type (`asyar:api:{service}:{action}`) is **classified in the Rust gate** — `asyar-launcher/src-tauri/src/permissions.rs`: either `get_required_permission` (needs a manifest permission) or `is_public_call` (deliberately permission-free). That is the ONLY enforcement point — there is no JS-side gate to update
- The gate **fails closed** (since 2026-07-24): a call type in neither list is DENIED, so a new proxy method nobody classified breaks loudly instead of becoming default-allowed
- New proxies are added to **the right entry's bag**: the worker entry
  ([`asyar-sdk/src/worker.ts`](../../../asyar-sdk/src/worker.ts)) only
  exposes proxies that don't depend on the DOM or user interaction; the
  view entry ([`asyar-sdk/src/view.ts`](../../../asyar-sdk/src/view.ts))
  exposes the full bag — it re-exports `contracts.ts`, which is where the
  shared proxies and `ExtensionContext` live. A misclassified proxy is a
  Phase-6 regression.

### 2. Permission gate coverage

Coverage is **auto-enforced** by `asyar-launcher/scripts/permission-coverage.test.mjs` (runs in CI via vitest): it extracts every `.invoke('service:action')` call type in the SDK and fails if any is not classified in the Rust gate (`get_required_permission` ∪ `is_public_call`). A forgotten mapping turns CI red — you no longer hand-audit this.

When adding/auditing a gated API, edit `asyar-launcher/src-tauri/src/permissions.rs`:

- Add gated calls to `get_required_permission` — the permission string must be a valid manifest permission (e.g. `clipboard:read`, `network`, `fs:read`, `runs:track`, `tools:register`). The generated `gatedPermissions.ts` (launcher + SDK CLI copies) is derived from it by `scripts/generate-permission-catalog.mjs` — run `pnpm gen:permission-catalog`
- Add deliberately permission-free calls to `is_public_call` (with a one-line rationale) — do NOT rely on fall-through, which now denies
- Verify with `pnpm exec vitest run scripts/permission-coverage.test.mjs` and `cargo test permissions::tests`

### 3. Tier 1 action registration

Tier 1 (built-in) extensions **must not** use `ActionServiceProxy` for registering actions. Callbacks are stripped by `JSON.stringify` in `postMessage` serialization.

Check every file in `asyar-launcher/src/built-in-features/*/index.ts`:

- Actions must be registered via `actionService.registerAction(...)` (the host singleton imported from `../../services/action/actionService.svelte`)
- Any use of `context.getService<IActionService>('actions')` for registering callbacks should be flagged

### 4. IPC response path

Verify that for any new service method added to a proxy:

- The host-side handler exists in `asyar-launcher/src/services/extension/ExtensionIpcRouter.ts` or a dedicated service file
- Replies are posted with `event.source.postMessage({ type: 'asyar:response', messageId, result }, '*')` on success — using `event.source` ensures the reply lands in the same iframe (worker or view) that issued the request
- Error path sends `{ type: 'asyar:response', messageId, error: string }`
- Host → iframe pushes that target a specific role go through `pickExtensionIframe(extensionId, prefer)` in `asyar-launcher/src/services/extension/extensionIframeSelector.ts` — never an unscoped `iframe[data-extension-id="..."]` selector

### 5. Role-aware dispatch checks (Phase 6+)

When auditing services that branch on iframe role:

- `actions.registerActionHandler` is role-neutral — registering from either role is supported and the launcher routes the matching `asyar:action:execute` envelope back to whichever role registered
- `commands.onCommand` for a `mode: "background"` manifest command must register from the **worker**; the launcher dispatches background-mode commands to the worker iframe
- `state:rpcRequest` / `state:rpcReply` envelopes carry the worker↔view RPC protocol; the worker-side interceptor in `asyar-sdk/src/worker.ts` is the only place that calls `extensionRpc.deliverActionPayload(...)`. View-side calls go through `context.request(...)` only.

## Files to read

- `asyar-sdk/src/ipc/MessageBroker.ts` — confirms `broker.invoke()` prepends `asyar:api:`
- `asyar-sdk/src/services/*Proxy.ts` — all proxy service files
- `asyar-sdk/src/worker.ts`, `asyar-sdk/src/view.ts`, `asyar-sdk/src/contracts.ts` — entry-point split
- `asyar-launcher/src-tauri/src/permissions.rs` — the real gate (`get_required_permission` + `is_public_call` + `gate_decision`, fail-closed)
- `asyar-launcher/scripts/permission-coverage.test.mjs` — the CI coverage gate (SDK call types ⊆ classified)
- `asyar-launcher/src/services/extension/ExtensionIpcRouter.ts` — host IPC handler + role-source mapping
- `asyar-launcher/src/services/extension/extensionIframeSelector.ts` — `pickExtensionIframe` role-prefer/fallback selector
- `asyar-launcher/src/built-in-features/*/index.ts` — Tier 1 action registration

## Host → Extension Push Messages (out of scope for this audit)

The host sends two push message types directly into extension iframes. These are **not** extension API calls — they originate from the host and require no permission gate:

| Message type            | Direction     | Purpose                                                           |
| ----------------------- | ------------- | ----------------------------------------------------------------- |
| `asyar:theme:variables` | host → iframe | Injects all CSS custom properties on load and on theme change     |
| `asyar:theme:fonts`     | host → iframe | Sends Satoshi + JetBrains Mono as base64 `@font-face` CSS on load |

Sender: `ExtensionIframe.svelte` (`handleIframeLoad`, `MutationObserver`)
Receiver: `ExtensionContext.ts` `setupThemeInjection()` in the SDK

These are host→iframe pushes, not extension calls, so they never reach the gate — do not flag them as missing.

## Output format

Report findings grouped by category:

1. **Missing permission gate entries** — type string + which proxy method
2. **Tier 1 proxy misuse** — file + line where ActionServiceProxy is misused
3. **Orphaned gate entries** — call types in `get_required_permission`/`is_public_call` with no matching SDK `.invoke()` (dead classification)
4. **IPC response path gaps** — proxy methods with no corresponding host handler
5. **Clean** — explicitly state if a category has no issues

If the request names a single service (e.g. "review-ipc for notifications"), scope the review to that service only.
