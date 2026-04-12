---
order: 5
---
# Permission System & Security Model

> For the full list of permission strings and what each one unlocks, see [permissions reference](../reference/permissions.md).

## 9. Security Model

Security defines the entire rationale for the architectural split. 

- **Tauri APIs inside Extensions:** A Tier 2 extension absolutely **cannot** access raw `@tauri-apps/api` hooks directly. The `<ExtensionIframe>` limits its sandbox, and Tauri specifically blocks iframes from bypassing the message interceptor. All requests to mutate OS context *must* transit over `postMessage` where the Host performs validation.
- **Iframe Sandbox:** Set to `allow-scripts allow-same-origin allow-forms allow-popups`. The `allow-same-origin` is a requirement to allow modern SPA routers and IndexedDB usage to function inside the extension context.
- **Content-Security-Policy (CSP):** The Rust `asyar-extension://` handler manually injects:
  `Content-Security-Policy: default-src asyar-extension: 'self'; script-src asyar-extension: 'unsafe-inline' 'unsafe-eval'; style-src asyar-extension: 'unsafe-inline';`
  - *Context on `unsafe-eval`:* Currently required because certain modern frontend packagers (and dev mode workflows) rely heavily on eval/new Function bindings.
- **Protocol Shadowing Prevention:** The Fallback Chain inherently protects the system. Rust Protocol resolution strictly checks `Priority 1: Debug source` (dev only), followed by `Priority 2: Built-in host resources`, and finally `Priority 3: Third Party AppData`. By validating against the built-in bundle *before* the user's AppData directory, the system ensures that a malicious extension attempting to install an override folder named `clipboard-history` (a built-in ID) can never usurp the genuine bundle logic in production.

> [!NOTE]
> **Permission Enforcement:** Permissions are enforced at two independent layers. The frontend `ExtensionIpcRouter` checks the calling extension's manifest before forwarding any postMessage to a Tauri command. The Rust `permissions.rs` registry performs a second independent check inside the process. Both layers must pass. If a permission is missing, the call returns a structured error immediately — it never hangs and the extension is not suspended.

## Permission enforcement — two independent layers

Permissions are enforced at **two independent layers**:

1. **Frontend IPC router** (`ExtensionIpcRouter.ts`): Before forwarding any postMessage to a Tauri command, checks whether the calling extension's manifest declares the required permission.
2. **Rust permission registry** (`permissions.rs`): A second independent check inside the Rust process.

Both layers must pass. If either rejects, the call returns a structured `{ allowed: false }` error immediately — it never hangs.

---

See also: [Two-tier model](./two-tier-model.md) · [IPC bridge](./ipc-bridge.md) · [Permissions reference](../reference/permissions.md)
