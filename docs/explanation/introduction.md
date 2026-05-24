---
order: 1
---
## 1. Introduction — The Asyar Ecosystem

Asyar is a cross-platform launcher and productivity platform (macOS, Linux, and Windows). The extension system turns it from a built-in tool into a platform — any developer can add commands, search results, and rich UI panels that feel native to the app.

### What an extension can do

- **Register commands** that appear in the global search bar when the user types a trigger phrase.
- **Return live search results** directly into the launcher as the user types (like a calculator or documentation search).
- **Open a full view panel** rendered as a sandboxed iframe — build menus, data tables, detail pages, and interactive UIs.
- **Show system notifications** via the system notification center.
- **Read and write the clipboard**, including the full history managed by Asyar.
- **Read the user's current selection** — selected text in the frontmost app, or selected items in the frontmost file manager — to power "act on selection" workflows like translate, summarize, upload, or compress.
- **Make outbound HTTP requests** through the host process (bypassing iframe CSP restrictions).
- **Register keyboard-accessible actions** in the ⌘K Action Drawer — contextual secondary operations.
- **Display live status items** in the system tray while a background task is running.
- **Read and write app settings** scoped to your extension's namespace.
- **Navigate between multiple views** within a single extension.

### The sandbox model

Every installed extension runs inside a sandboxed `<iframe>`. The iframe loads your bundled HTML/JS/CSS through a custom `asyar-extension://` protocol — it is not a web page and has no internet origin. All communication with Asyar (firing notifications, reading the clipboard, navigating views) goes through a `postMessage` bridge that the SDK wraps for you.

**The practical consequences:**

- Your extension **cannot crash Asyar**. A runtime error inside your iframe does not propagate to the host.
- Your extension **cannot access another extension's storage** or the host's DOM.
- Every dependency — including Svelte itself — **must be bundled** into your `dist/` output.
- **External CDN script tags are blocked** by the iframe's Content Security Policy. All networking must go through `NetworkService`.
- If you call an API without declaring its required permission, the host **blocks the call immediately** and returns a structured error. It never hangs.

### Why Svelte 5 + Vite?

The scaffolder and all examples use Svelte 5 with Runes (`$state`, `$derived`, `$effect`) because Svelte compiles away its runtime — resulting in the smallest possible bundles with no virtual DOM overhead. For an iframe loaded fresh on every panel open, bundle size and startup speed matter. That said, any framework that bundles to static HTML/JS/CSS works — React, Vue, and vanilla JS are all valid choices.
