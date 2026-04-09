## 18. Troubleshooting & FAQ

### FAQ

**Q: Can I use React or Vue instead of Svelte?**

Yes. Any framework that builds to static HTML/JS/CSS works. Install the framework, configure Vite accordingly, and bundle everything. The only constraint is that all dependencies must be in `dist/` — there is no shared runtime.

**Q: Can I use `localStorage` for storage?**

Yes, `localStorage` is scoped to the `asyar-extension://` origin within your extension's iframe. Data persists across sessions and is completely isolated from other extensions. Use it freely for transient local state. For data that should survive extension updates and be backed by SQLite, use `StorageService` instead (requires `storage:read`/`storage:write` permissions). Use `SettingsService` when you need reactive subscription support.

**Q: Can I open a URL in the system browser?**

Yes, declare `"shell:open-url"` in your permissions and send a raw postMessage:

```typescript
window.parent.postMessage({
  type: 'asyar:api:opener:open',
  url: 'https://example.com',
}, '*');
```

**Q: How do I pass data between views within my extension?**

The recommended approach is URL query parameters: encode your context into the `viewPath` string you pass to `navigateToView()`. The detail view reads them via `new URLSearchParams(window.location.search)`.

For larger or more complex state, use `localStorage`, `StorageService`, or `SettingsService`. The entire extension runs in one iframe (the URL changes but the iframe document is reloaded each time `navigateToView` is called), so `localStorage` is the simplest cross-view store. Use `StorageService` if you need data to survive extension updates and be backed by SQLite.

**Q: My extension shows in Asyar but the view is blank.**

1. Open DevTools (right-click → Inspect Element in your extension's panel area).
2. Check the Console for JavaScript errors.
3. Confirm `window.parent.postMessage({ type: 'asyar:extension:loaded', extensionId }, '*')` is called in `main.ts`. Without this signal, the host will not consider the iframe initialized.
4. Check that `index.html` has `<div id="app"></div>` and the `<script>` tag pointing to `src/main.ts`.

**Q: The `asyar:extension:loaded` signal — is it required?**

Yes. The host waits for this specific postMessage before routing any service calls or action triggers to your iframe. Without it, your extension appears loaded in the panel but service calls from the host (like search queries or command invocations) never arrive.

**Q: Can I have multiple views in one extension?**

Yes. Define multiple components (e.g., `DefaultView.svelte`, `DetailView.svelte`, `SettingsView.svelte`) and export them all from `index.ts`. In `main.ts`, read `?view=` from the URL and mount the correct component. Navigate between them with `extensionManager.navigateToView('your.ext.id/SettingsView')`.

**Q: My search results' `action` function is not called when the user selects a result.**

This is expected for Tier 2 (installed) extensions. The `action` closure cannot be serialized over `postMessage`. Set `viewPath` on your results instead, and Asyar will navigate there automatically when the user selects the result.

**Q: What happens when my extension is uninstalled?**

The Rust backend:
1. Validates the extension is not a built-in (built-in extensions cannot be uninstalled).
2. Deletes the extension's directory from `$APP_DATA/extensions/`.
3. Removes the entry from the app's settings store.
4. Removes the extension from the in-memory registry.
5. Emits an `extensions_updated` event to the frontend.

Any registered status bar items from the extension are cleared automatically. Any still-registered actions in the ⌘K drawer are also cleared.

**Q: How do I open VS Code for my extension after generating it?**

The Create Extension scaffolder opens VS Code automatically. For subsequent sessions:
```bash
code .   # from within your extension directory
```

Or open the folder manually in your IDE. The `dev_extensions.json` registration persists — you never need to re-link.

**Q: How do I make my extension macOS-only (or any specific OS)?**

Add a `platforms` field to your `manifest.json` listing only the operating systems you support:

```json
"platforms": ["macos"]
```

Valid values are `"macos"`, `"windows"`, and `"linux"`. You can list any combination:

```json
"platforms": ["macos", "linux"]
```

**Omit the field entirely for a universal extension** — that is the default and the most common case. Extensions with an incompatible `platforms` list are hidden in the store on unsupported OSes and blocked from loading by the host. The `asyar validate` CLI command will reject unknown platform values.

**Q: What is `asyarSdk` in the manifest for?**

It declares the minimum SDK version your extension requires. Asyar checks this against the app's bundled SDK version at discovery time. If the app's SDK is older than your requirement, the extension is marked incompatible and will not load. Set it to the version you developed against: `"asyarSdk": "^1.3.3"`.

**Q: Can my extension communicate with another extension?**

Not directly. Extensions are fully isolated. Shared state must go through the host (e.g., a shared settings key accessible via `SettingsService`). Direct cross-extension communication is not supported in the current architecture.

**Q: How do I debug `NetworkService` requests?**

The `NetworkService` routes requests through the Rust backend. The actual HTTP call is not visible in the iframe's DevTools Network tab (since it doesn't originate from the iframe). Log the request and response in your code:

```typescript
const res = await network.fetch(url, options);
logger.debug(`HTTP ${res.status} ${url} → ${res.body.slice(0, 200)}`);
```

Check the Asyar developer log for these messages.

---

*This document is maintained alongside the `asyar-sdk` package. For bug reports, feature requests, or corrections, open an issue in the Asyar project repository.*
