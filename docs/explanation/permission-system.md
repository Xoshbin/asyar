---
order: 5
---

# Permission System & Security Model

> For the full list of permission strings and what each one unlocks, see [permissions reference](../reference/permissions.md).

## 9. Security Model

Security defines the entire rationale for the architectural split.

- **Tauri APIs inside Extensions:** A Tier 2 extension absolutely **cannot** access raw `@tauri-apps/api` hooks directly. The `<ExtensionIframe>` limits its sandbox, and Tauri specifically blocks iframes from bypassing the message interceptor. All requests to mutate OS context _must_ transit over `postMessage` where the Host performs validation.
- **Iframe Sandbox:** Set to `allow-scripts allow-same-origin allow-forms allow-popups`. The `allow-same-origin` is a requirement to allow modern SPA routers and IndexedDB usage to function inside the extension context.
- **Content-Security-Policy (CSP):** The Rust `asyar-extension://` handler manually injects:
  `Content-Security-Policy: default-src asyar-extension: 'self'; script-src asyar-extension: 'unsafe-inline' 'unsafe-eval'; style-src asyar-extension: 'unsafe-inline';`
  - _Context on `unsafe-eval`:_ Currently required because certain modern frontend packagers (and dev mode workflows) rely heavily on eval/new Function bindings.
- **Protocol Shadowing Prevention:** The Fallback Chain inherently protects the system. Rust Protocol resolution strictly checks `Priority 1: Debug source` (dev only), followed by `Priority 2: Built-in host resources`, and finally `Priority 3: Third Party AppData`. By validating against the built-in bundle _before_ the user's AppData directory, the system ensures that a malicious extension attempting to install an override folder named `clipboard-history` (a built-in ID) can never usurp the genuine bundle logic in production.

> [!NOTE]
> **Permission Enforcement:** Permissions are enforced at two independent layers. The frontend `ExtensionIpcRouter` checks the calling extension's manifest before forwarding any postMessage to a Tauri command. The Rust `permissions.rs` registry performs a second independent check inside the process. Both layers must pass. If a permission is missing, the call returns a structured error immediately — it never hangs and the extension is not suspended.

## Permission enforcement — two independent layers

Permissions are enforced at **two independent layers**:

1. **Frontend IPC router** (`ExtensionIpcRouter.ts`): Before forwarding any postMessage to a Tauri command, checks whether the calling extension's manifest declares the required permission.
2. **Rust permission registry** (`permissions.rs`): A second independent check inside the Rust process.

Both layers must pass. If either rejects, the call returns a structured `{ allowed: false }` error immediately — it never hangs.

---

## Local-network access (`network:lan`)

By default, the `network` permission permits outbound requests only to public IP addresses. Access to private RFC 1918 subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), Carrier-Grade NAT (`100.64.0.0/10`), IPv6 Unique Local Addresses (`fc00::/7`), and `.local` mDNS domains is blocked to prevent DNS rebinding and intranet Server-Side Request Forgery (SSRF) attacks against local network hardware and services.

The `network:lan` permission selectively opens access to approved local devices:

- **Scoping**: Specific endpoints or CIDR ranges can be pre-declared via `permissionArgs["network:lan"]`, or authorized dynamically by the user.
- **Fail-Closed Privacy & WebBluetooth Model**: Sandboxed extensions cannot open raw UDP/multicast sockets to scan the user's subnet or map internal network topology (preventing ambient network surveillance). Discovery is user-mediated by the launcher's native Tauri runtime through `network.requestLanDevice()`.
- **Pre-Prompt SSRF Validation**: Rust verifies that target hosts and ports do not resolve to loopback (`127.0.0.1`, `::1`) or cloud link-local metadata endpoints (`169.254.169.254`) _before_ prompting the user for approval.
- **DNS Resolution Pinning**: On every request and redirect, DNS answers are resolved and verified against the authorized LAN scope before connecting.

See [manifest LAN schema](../reference/manifest.md#lan-endpoint-schema) and
[network service local-network access](../reference/sdk/network-service.md#local-network-access).

---

## Secret references

`network:secrets` is an opt-in, parameterized permission that also requires
`network`. Extensions name a login secret's generic source (Keychain item or
JSON file), destination hosts, methods, optional path prefixes, and header
template. Consent shows those declarations before use. The platform has no
provider-specific login logic.

The threat model is an extension that needs authenticated requests but should
not possess the user's token. Rust resolves the source and injects the header;
the SDK passes only reference names. Rust enforces exact HTTPS destinations and
declared methods (GET by default), refuses to follow redirects, and redacts
responses before returning them. Response and timeout caps bound resource use.
No token refresh or write occurs: HTTP 401 should lead the user back to their
CLI to sign in. Ordinary requests remain unchanged.

This is **not** a guarantee that every server response is safe:

- **Partial or transformed token echoes** may evade redaction; an untrusted
  server can return fragments or encode the token rather than echo it intact.
- **Consenting to a bad host** authorizes sending the secret to that host.
  Review the exact ASCII/punycode destination, port, methods, and paths. The
  host allowlist cannot decide whether a service is trustworthy.
- **Combining with `shell:spawn`** lets an extension run a program that reads
  the credential file itself. Secret-reference isolation does not revoke the
  broader access separately granted by shell permissions. Known AI CLI token
  files are excluded from `files:read`, even if a glob would cover them.

See [manifest schema](../reference/manifest.md#secret-reference-schema) and
[network service semantics](../reference/sdk/network-service.md#secret-references).

See also: [Two-tier model](./two-tier-model.md) · [IPC bridge](./ipc-bridge.md) · [Permissions reference](../reference/permissions.md)
