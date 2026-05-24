---
order: 9
---
# Host Startup, Installation & View Rendering

## 3. Application Startup Sequence

When the user launches Asyar, the startup process follows a strict sequence to guarantee that OS hooks, system services, and extensions are securely bolted together before the UI is presented:

1. **Rust Initialization (`main.rs` -> `lib.rs:run()`):** 
   - Tauri builder starts.
   - Core plugins are initialized (`fs`, `http`, `global_shortcut`, `clipboard_manager`, `opener`).
2. **Custom Protocol Registration:**
   - `.register_uri_scheme_protocol("asyar-extension", ...)` sets up the handler for Tier 2 extension asset resolution.
3. **App Setup phase (`setup_app`):**
   - System tray icon and menu are configured.
   - The main window (`SPOTLIGHT_LABEL`) is retrieved and OS-specific composition (e.g., Vibrancy on macOS, Blur on Windows) is applied.
   - A global shortcut (defaulting to `Cmd+K` / `Ctrl+K`) is registered to toggle window visibility.
4. **WebView Hydration (`+page.svelte` mounted):**
   - SvelteKit boots in the webview.
   - `onMount` calls `appInitializer.init()`.
5. **Auth Initialization:**
   - `authService.init()` is called (Tauri-only, skipped in browser mode).
   - Loads encrypted token + cached entitlements from `auth.dat` via `auth_load_cached` Tauri command.
   - If a cached session is found, `AuthState` (Rust managed state) is populated immediately — the UI can show the logged-in state before any network call.
   - A background `auth_refresh_entitlements` call fetches fresh entitlements from `https://asyar.org/api/entitlements`. On failure, cached entitlements are used (7-day grace period). If the cache is older than 7 days and the network is unreachable, entitlements are cleared and a non-blocking notification is shown.
6. **Theme Application (if persisted):**
   - `extensionManager.init()` reads `settings.appearance.activeTheme` immediately after `settingsService.init()`.
   - If a theme ID is stored, `applyTheme(themeId)` is called fire-and-forget (`.catch()`) so it does not block extension loading.
   - The Rust `get_theme_definition` command reads `theme.json` from the extension directory and returns the CSS variable map and font declarations to the frontend.
7. **Extension Discovery & Loading (`extensionLoaderService.ts`):**
   - `loadAllExtensions()` is triggered.
   - **Tier 1:** Discovered synchronously via Vite's `import.meta.glob('/src/built-in-features/*/index.ts', { eager: true })`.
   - **Tier 2:** Rust command `discover_extensions` is queried. Returns all installed extension records (manifest + enabled state + path).
   - **Theme extensions** (`type === "theme"`) are present in the discovered records but skipped by `ExtensionLoaderService` — they have no JS module to load.
8. **Command Index Synchronization:**
   - Once all manifests are loaded, `ExtensionManager.syncCommandIndex()` is fired.
   - All extension `commands` are formatted into `cmd_${extension.id}_${command.id}` objects.
   - The Rust-backed search engine updates the index via invoke hooks (`index_item`, `delete_item`).
9. **Ready State:**
   - `ExtensionManager.isReady` evaluates to `true`.
   - The UI enables the search bar and waits for user input.

---

## 5. Extension Installation Pipeline

Two installation paths exist: store/URL download and local file install.

### Path A — Store / URL download

When a user discovers a third-party extension in the Store:

1. **User Interaction:** The user clicks "Install" in the `DetailView.svelte` of the built-in Store.
2. **Download Handlers:** The UI invokes the Tauri command `install_extension_from_url`.
3. **Rust Processing:**
   - Downloads the extension archive from the provided URL using the `reqwest` HTTP client.
   - Saves the downloaded payload to a temporary file (`NamedTempFile`).
   - Verifies the SHA-256 checksum against the value stored in the Asyar Store API. Mismatches abort installation.
   - Extracts the zip archive into `$APP_DATA/extensions/{extensionId}/`.
4. **Live Reload:** `extensionLoaderService.loadAllExtensions()` picks up the new extension without a restart.
5. **Indexing:** `ExtensionManager.syncCommandIndex()` pushes the new commands into the Rust search index.
6. **Failure Cleanup:** If download or extraction fails, Rust purges the installation directory before returning an error.

### Path B — Local file install (`.asyar`)

Users can also install from a local `.asyar` file (a renamed ZIP) via Settings → Extensions → **Install from File...**. This supports all extension types — `view`, `result`, and `theme`.

1. **User Interaction:** User clicks "Install from File..." → native file picker filtered to `*.asyar`.
2. **Frontend:** Calls `show_open_extension_dialog` Tauri command (returns the selected path), then `install_extension_from_file` with that path.
3. **Rust processing (`install_from_file`):**
   - Validates the file has a `.asyar` extension.
   - Extracts the ZIP to a temp directory (reuses `extract_zip()` with zip-slip protection).
   - Reads and validates `manifest.json` (reuses `read_manifest()` + `validate_compatibility()`).
   - Runs `validate_package_structure()`:
     - Required fields: `id`, `name`, `version`, `type`.
     - ID format: alphanumeric, hyphens, dots, underscores — no `..`.
     - Type-specific: `theme` → requires `theme.json`; `view`/`result` → requires `index.html`.
   - Runs `validate_theme_json()` for theme packages: validates font file extensions (`.woff2`, `.ttf`, `.otf` only), path traversal, and CSS injection in font family names.
   - Version conflict check: same ID + higher version → upgrade; same/lower → error; new ID → fresh install.
   - Moves the extracted directory to `$APP_DATA/extensions/{id}/`.
4. **Live Reload:** Same as Path A — `discover_extensions` event triggers extension list refresh.

---

## 6. Extension View Rendering Pipeline

This flow details exactly how Asyar transitions from a user pressing `Enter` on a search result to rendering an extension view.

### For Tier 1 (Built-in)
1. User highlights a command in `<ResultsList>` and hits `Enter` (`handleEnterKey` / `handleCommandAction`).
2. The Action object invokes `extensionManager.handleCommandAction(commandObjectId)`.
3. The command handler matches the internal route and executes `this.navigateToView('clipboard-history/DefaultView')`.
4. The `$activeView` store (managed by `viewManager`) updates.
5. In `src/routes/+page.svelte`, the main reactive block evaluates `isBuiltInExtension('clipboard-history')`, yielding `true`.
6. The frontend fetches the native ES module via `extensionManager.getLoadedExtensionModule('clipboard-history')`.
7. The target Svelte class is extracted via standard fallback logic:
   `component = module?.[viewName] ?? module?.default?.[viewName] ?? module?.default;`
8. `<svelte:component this={component} />` mounts cleanly inside the main DOM.

### For Tier 2 (Installed)
1. User highlights a command for `xyz-plugin` and hits `Enter`.
2. `extensionManager.handleCommandAction()` invokes the generic command handler hook.
3. Because evaluating `isBuiltInExtension('xyz-plugin')` yields `false`, the fallback generic handler issues `this.navigateToView('xyz-plugin/DefaultView')`.
4. The `$activeView` store updates.
5. In `src/routes/+page.svelte`, because `isBuiltIn` is false, it mounts `<ExtensionIframe extensionId="xyz-plugin" view="xyz-plugin/DefaultView" />`.
6. `ExtensionIframe.svelte` reactively generates the `src` attribute string:
   `asyar-extension://xyz-plugin/index.html?view=DefaultView`
7. The `<iframe sandbox="allow-scripts allow-same-origin allow-forms allow-popups">` DOM node is attached.
8. **Protocol Interception (`lib.rs`):** The network request for `asyar-extension://` is intercepted by the Tauri Rust core.
9. **Path Resolution:** 
   - Rust strips query parameters (`?view=DefaultView`) using `.split('?').next().unwrap()`.
   - It iterates through paths in a strict, security-focused priority order: it checks Host bundle resources (Priority 2) **first**, and only if not found does it check the user AppData directory (Priority 3). Priority 1 is reserved exclusively for a localized development source directory and is only evaluated in debug builds.
10. **Delivery:** Rust reads `index.html` from disk, attaches Content-Security-Policy headers, and sets the mime type (`text/html`), serving it as bytes directly to the iframe webview.
11. **Extension Boot:** The extension's `index.html` executes its imported JS chunk (`main.ts`).
12. **SDK Hook:** Extension code executes `new ExtensionContext()`, taking over the iframe window and establishing the `MessageBroker` listener back to `window.parent`.
13. The extension's internal framework layout mounts, and the screen updates with external UI pixels.

---
