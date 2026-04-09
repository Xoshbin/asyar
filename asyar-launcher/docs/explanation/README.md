# Explanation

Understanding-oriented background. These pages describe how Asyar works and why — useful when you need to reason about behaviour, not just invoke an API.

## Pages in this section

### Conceptual overview

- **[Introduction](./introduction.md)** — What Asyar is, what an extension can do, the sandbox model, why Svelte 5 + Vite.

### Extension architecture (for extension authors)

- **[Two-tier model](./two-tier-model.md)** — Built-in features vs installed extensions. Why the two-tier split exists.
- **[IPC bridge](./ipc-bridge.md)** — How service calls travel from an iframe to the host and back.
- **[asyar-extension:// protocol](./asyar-extension-protocol.md)** — How iframe URLs resolve to files on disk.
- **[Permission system](./permission-system.md)** — Iframe sandbox, CSP, and the two-layer permission check.
- **[Lifecycle](./lifecycle.md)** — Discovery → initialize → activate → active → deactivate.

### Launcher internals (for contributors)

- **[System overview](./system-overview.md)** — The Rust host, SvelteKit WebView, and the custom protocol.
- **[Technology stack](./technology-stack.md)** — Tauri 2, SvelteKit, asyar-sdk, the custom protocol.
- **[Host startup, installation & view rendering](./host-startup-and-installation.md)** — What happens from app launch to a rendered view.
- **[Host OS integration & data flow](./host-os-integration.md)** — OS-level hooks and cross-layer data flow diagrams.
- **[Auth & subscription](./auth-and-subscription.md)** — The entitlement system and cached sessions.
- **[Data persistence](./data-persistence.md)** — Where things are stored and known limitations.
