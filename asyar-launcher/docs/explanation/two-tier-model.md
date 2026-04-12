---
order: 2
---
# The Two-Tier Model

Asyar extensions come in two tiers. Understanding this distinction shapes every architectural decision you make.

```
┌─────────────────────────────────────────────────────────────────────┐
│                     ASYAR HOST PROCESS (Tauri)                      │
│                                                                     │
│   ┌─────────────────────────────┐   ┌───────────────────────────┐  │
│   │     TIER 1: BUILT-IN        │   │  TIER 2: INSTALLED        │  │
│   │     FEATURES                │   │  EXTENSIONS               │  │
│   │                             │   │                           │  │
│   │  Calculator, Snippets,      │   │  Your extension           │  │
│   │  Shortcuts, AI Chat,        │   │  Any third-party ext      │  │
│   │  Portals, Create Extension  │   │                           │  │
│   │                             │   │  ┌─────────────────────┐  │  │
│   │  Runs IN host context.      │   │  │  <iframe> sandbox   │  │  │
│   │  Direct access to all       │   │  │  asyar-extension:// │  │  │
│   │  Tauri APIs. No sandbox.    │   │  │                     │  │  │
│   │  isBuiltIn: true            │   │  │  postMessage bridge │  │  │
│   │                             │   │  └─────────────────────┘  │  │
│   └─────────────────────────────┘   └───────────────────────────┘  │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │                    RUST CORE (Tauri 2)                      │  │
│   │  Discovery · Lifecycle · Permissions · URI Scheme · Search  │  │
│   └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Tier 1 — Built-in Features
- **Location:** Reside directly within the source tree at `src/built-in-features/*/`.
- **Loading:** Discovered using Vite's `import.meta.glob` during the build phase. The JavaScript modules are fully bundled.
- **Context:** They run directly within the Privileged Host Context (the same `window` object as SvelteKit).
- **Execution:** Flagged internally as `isBuiltIn: true`. They export a standard Svelte component via falling back through module keys (typically `DefaultView`). They can directly access Tauri commands and internal DOM elements without serialization overhead.
- **Convention:** The component must be exported as `DefaultView` to correctly match routing identifiers.

## Tier 2 — Installed Extensions
- **Location:** Reside dynamically on the OS-specific application data directory (macOS: `~/Library/Application Support/org.asyar.app/extensions/`, Windows: `%APPDATA%/org.asyar.app/extensions/`, Linux: `~/.local/share/org.asyar.app/extensions/`).
- **Loading Strategy:** Manifest-only. When the Host application starts, `ExtensionLoaderService` parses their `manifest.json` files and extracts the commands, but explicitly sets `module: null`. **The host application never evaluates or imports a Tier 2 extension's JavaScript directly in the main window.**
- **Context:** Flagged as `isBuiltIn: false`. They execute entirely within an isolated `<iframe>` sandbox.
- **Deferred Execution:** The code environment for a Tier 2 extension only boots when a user executes a specific command mapped to that extension, causing the Host to construct and mount the sandbox `<ExtensionIframe>`.
- **Bootstrap pattern:** A Tier 2 extension's `main.ts` creates its own `ExtensionContext` and calls `setExtensionId(id)`. That single call wires the context into the iframe's `ExtensionBridge` singleton (via `registerActiveContext`), patches all service proxies with the extensionId, and drains any already-delivered preferences bundle. The extension can then call `context.getService<T>(name)` or read `context.preferences.*` immediately. See [Preferences → How the bundle reaches the live context](../reference/sdk/preferences.md#how-the-bundle-reaches-the-live-context-tier-2) and the [IPC bridge preferences section](./ipc-bridge.md#preferences-delivery--asyareventpreferencesset-all).
- **Theme extensions (`type: "theme"`):** A sub-class of Tier 2 that contains no JavaScript. Theme packages declare CSS variable overrides and optional custom fonts in `theme.json`. `ExtensionLoaderService` discovers theme extensions normally but skips them during module loading — they never get an iframe. Theme application is handled exclusively by `themeService.ts`, which reads the theme definition via the `get_theme_definition` Rust command and applies CSS variables directly to `document.documentElement`.

## Historical note — why not dynamic `import()`

- **Why not `dynamic import()` in the host window?** An earlier implementation loaded Tier 2 extensions via `import(/* @vite-ignore */ 'asyar-extension://{id}/dist/index.js')` directly into the host window. This caused three cascading failures: (1) the extension bundled its own copy of `MessageBroker`, creating a duplicate singleton that never correctly bound to the host's state, (2) `window.parent === window` in the same execution context, causing `postMessage` calls to loop back to the sender, and (3) `extensionId` context from the host's injected `ExtensionContext` was ignored because the extension's internally bundled SDK instance was a different object in memory. The iframe model eliminates all three problems by giving each extension a genuinely separate JavaScript execution context.

---

See also: [IPC bridge](./ipc-bridge.md) · [Permission system](./permission-system.md)
