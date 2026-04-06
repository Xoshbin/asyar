# Asyar Architecture Documentation

This document provides a comprehensive, production-grade technical overview of the Asyar application architecture. It serves as the definitive reference for how the application is structured, how extensions are loaded and executed, and how isolated contexts securely communicate with the host environment.

---

## 1. System Overview

Asyar is an extensible desktop launcher and productivity tool built on the Rust-based Tauri framework and web technologies. The core architectural challenge Asyar solves is providing a unified search and command execution interface capable of running both deeply integrated native features (Tier 1) and isolated third-party extensions (Tier 2) without compromising host security or user experience.

```ascii
+-----------------------------------------------------------------------------------+
|                                 Operating System (macOS / Windows / Linux)        |
+-----------------------------------------------------------------------------------+
      | Global Hotkeys        | Tray Menu       | File System       | Clipboard
+-----------------------------------------------------------------------------------+
|                                   Rust Host (Tauri 2)                             |
|  - asyar_lib::run()                                                               |
|  - Custom Protocol: asyar-extension://                                            |
|  - Global Shortcuts, Window Management, Notifications                             |
+-----------------------------------------------------------------------------------+
      | Tauri IPC (`@tauri-apps/api/core`)
+-----------------------------------------------------------------------------------+
|                            Privileged Host Context (WebView)                      |
|                                                                                   |
|  SvelteKit Frontend (`src/routes/+page.svelte`)                                   |
|  - ExtensionManager (`extensionManager.ts`)                                       |
|  - ExtensionLoaderService (`extensionLoaderService.ts`)                           |
|  - SearchService & Command Index                                                  |
|                                                                                   |
|  +---------------------------------------+                                        |
|  |     Tier 1: Built-in Features       |                                        |
|  |     (Shared JS Context)               |                                        |
|  |     e.g., Clipboard History, Store    |                                        |
|  +---------------------------------------+                                        |
|       | asyar-sdk proxy        ^                                                  |
|       v                        |                                                  |
|  +---------------------------------------+    +--------------------------------+  |
|  |        ExtensionIframe.svelte         |    |   Tier 2: Installed Extensions |  |
|  |        (IPC Bridge / postMessage)     |<---|   (Isolated Iframe Sandbox)    |  |
|  +---------------------------------------+    +--------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## 2. Technology Stack

### Tauri 2 (Rust + WebView)
Tauri is the foundational application framework. Unlike Electron, which bundles a full Chromium and Node.js runtime, Tauri utilizes the OS's native webview (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux). 
- **Rust Backend:** Responsible for OS-level integrations: global hotkeys (`tauri_plugin_global_shortcut`), filesystem manipulation, system tray, window vibrancy, clipboard, and the custom protocol implementation.
- **WebView:** Hosts the entire SvelteKit frontend application.

### SvelteKit
Used for building the primary user interface.
- **Routing & Rendering:** The application renders essentially as a Single Page Application (SPA). The main interface resides at `src/routes/+page.svelte`.
- **SSR disabled:** Server-Side Rendering (SSR) is completely disabled (adapter-static) because this application runs in a desktop webview, meaning there is no Node.js backend to perform SSR.
- **Vite:** Powers the build pipeline, heavily utilized for its `import.meta.glob` feature which enables eager discovery of built-in extensions at build time.

### asyar-sdk
A universal bridge SDK mapped into an npm package (`asyar-sdk`). It exports `ExtensionContext`, `ExtensionBridge`, `MessageBroker`, and proxies for standard host services (`LogService`, `NotificationService`, `ClipboardHistoryService`, etc.). Its role is to emulate local service access inside an iframe by serializing method calls over `postMessage` IPC back to the privileged host context.

### The `asyar-extension://` Custom Protocol
A custom requested defined in `src-tauri/src/lib.rs`. It intercepts network requests generated by iframed extensions and reads the actual assets from the local filesystem (either from the app's resource directory or the app_data installation directory), bypassing stringent local file schema (`file://`) CORS policies.

---

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

## 4. Extension Architecture — Two-Tier Model

The system utilizes a Two-Tier Model to solve the juxtaposition of requiring native-feeling deeply integrated features while mitigating security risks associated with arbitrary community plugins.

### Tier 1 — Built-in Features
- **Location:** Reside directly within the source tree at `src/built-in-features/*/`.
- **Loading:** Discovered using Vite's `import.meta.glob` during the build phase. The JavaScript modules are fully bundled.
- **Context:** They run directly within the Privileged Host Context (the same `window` object as SvelteKit).
- **Execution:** Flagged internally as `isBuiltIn: true`. They export a standard Svelte component via falling back through module keys (typically `DefaultView`). They can directly access Tauri commands and internal DOM elements without serialization overhead.
- **Convention:** The component must be exported as `DefaultView` to correctly match routing identifiers.

### Tier 2 — Installed Extensions
- **Location:** Reside dynamically on the OS-specific application data directory (macOS: `~/Library/Application Support/org.asyar.app/extensions/`, Windows: `%APPDATA%/org.asyar.app/extensions/`, Linux: `~/.local/share/org.asyar.app/extensions/`).
- **Loading Strategy:** Manifest-only. When the Host application starts, `ExtensionLoaderService` parses their `manifest.json` files and extracts the commands, but explicitly sets `module: null`. **The host application never evaluates or imports a Tier 2 extension's JavaScript directly in the main window.**
- **Context:** Flagged as `isBuiltIn: false`. They execute entirely within an isolated `<iframe>` sandbox.
- **Deferred Execution:** The code environment for a Tier 2 extension only boots when a user executes a specific command mapped to that extension, causing the Host to construct and mount the sandbox `<ExtensionIframe>`.
- **Theme extensions (`type: "theme"`):** A sub-class of Tier 2 that contains no JavaScript. Theme packages declare CSS variable overrides and optional custom fonts in `theme.json`. `ExtensionLoaderService` discovers theme extensions normally but skips them during module loading — they never get an iframe. Theme application is handled exclusively by `themeService.ts`, which reads the theme definition via the `get_theme_definition` Rust command and applies CSS variables directly to `document.documentElement`.
- **Why not `dynamic import()` in the host window?** An earlier implementation loaded Tier 2 extensions via `import(/* @vite-ignore */ 'asyar-extension://{id}/dist/index.js')` directly into the host window. This caused three cascading failures: (1) the extension bundled its own copy of `MessageBroker`, creating a duplicate singleton that never correctly bound to the host's state, (2) `window.parent === window` in the same execution context, causing `postMessage` calls to loop back to the sender, and (3) `extensionId` context from the host's injected `ExtensionContext` was ignored because the extension's internally bundled SDK instance was a different object in memory. The iframe model eliminates all three problems by giving each extension a genuinely separate JavaScript execution context.

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

## 7. IPC Communication Architecture

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

---

## 8. OS Communication

Asyar relies strictly on Rust for handling raw Operating System tasks.

- **Global Hotkey Registration:** Managed via the `tauri_plugin_global_shortcut` crate. The core logic sits in `lib.rs:setup_global_shortcut()`.
  - **Conflict Handling:** If a shortcut registration fails (e.g., the user attempts to bind a key combination already reserved by the OS or another app), the `Err` is caught and logged to standard error (`eprintln!`). 
  - **User Experience:** Crucially, a hotkey conflict **does not crash the app**. Asyar continues its startup sequence and launches successfully. However, there is no automatic fallback hotkey assigned. The user will simply find the hotkey unresponsive and must use the System Tray icon to open the app and rebind the shortcut in settings.
- **System Tray:** Defined in `src-tauri/src/tray.rs`. Interacts with `tauri::tray::TrayIconBuilder` and provides dynamic menu capabilities. Left clicks trigger window presence state toggles.
  - The tray menu is now dynamic — extensions can register live status items via `StatusBarService` (`src/services/statusBar/statusBarService.ts`).
  - The host-side store (`statusBarItemsStore`) auto-syncs to the Rust tray via `invoke('update_tray_menu')` with a 300ms debounce.
  - The Rust command `update_tray_menu` in `src-tauri/src/command.rs` rebuilds the full menu on each call: extension items → separator → Settings → Quit.
  - Tray click events are emitted as `tray-item-clicked` with a `extensionId:itemId` composite payload; `src/services/appInitializer.ts` listens and navigates to the correct extension view.
- **Filesystem Access:** Leverages `tauri_plugin_fs`. Host paths strictly use Tauri's path resolution API (`appDataDir()`) to ensure compliance with each platform's data directory conventions.
- **Clipboard Access:** Leveraged via the `tauri_plugin_clipboard_manager`.
- **Window Management:** The main window behaves like a Spotlight search bar rather than a standard application window.
  - **macOS:** The app uses the `tauri_nspanel` crate. `window.to_spotlight_panel()?` converts the Tauri window into a native `NSPanel`. The app listens to `{SPOTLIGHT_LABEL}_panel_did_resign_key` (fired when the user clicks outside) to auto-hide via `panel.order_out(None)`, unless the window is pinned.
  - **Windows:** Visual composition uses `apply_blur`. Window focus-loss and hide behavior is handled through Tauri's standard window event system.
  - **Linux:** Window management follows Tauri's standard cross-platform APIs. Visual blur effects are not applied on Linux.
  - Visual composition effects are platform-gated: `apply_vibrancy` on macOS, `apply_blur` on Windows, no-op on Linux.

---

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

---

## 10. Developer Guide — Building a Tier 2 Extension

Extensions are built using standard web technologies compiled to a static folder layout. 

### Step-by-step
1. **Scaffold Directory Structure:**
   ```
   my-extension/
   ├── manifest.json
   ├── vite.config.ts
   ├── src/
   │   ├── main.ts
   │   └── App.svelte
   ```
2. **Configure `manifest.json`:**
   Define your commands matching the exact schema requirement. 
   - Include your `id` (must be unique string formatting).
   - Set `type: "view"`.
   - Provide standard `commands` array with an actionable `trigger` search term.
3. **Configure the Bundler (`vite.config.ts`):**
   - You **MUST** define `base: './'`. Absolute paths (`/assets/script.js`) will fail when routed deeply through the `asyar-extension://{id}/` custom protocol.
   - Do not mark dependencies (like Svelte) as externalized. The extension must be a complete monolithic app bundle that ships inside the iframe.
4. **Bootstrapping (`main.ts`):** 
   You must establish connection to the host frame prior to app rendering.
   ```typescript
   import { ExtensionContext } from 'asyar-sdk';
   import manifest from '../manifest.json';
   
   // Initialize context, giving the broker its identity.
   const context = new ExtensionContext();
   context.setExtensionId(manifest.id);
   ```
5. **Testing Locally:**
   Use the `asyar` CLI to link and develop your extension:
   ```bash
   cd my-extension/
   asyar link    # symlinks into app data extensions dir
   asyar dev     # watch mode with hot reload
   ```
   Extension directories per platform:
   - macOS: `~/Library/Application Support/org.asyar.app/extensions/`
   - Windows: `%APPDATA%/org.asyar.app/extensions/`
   - Linux: `~/.local/share/org.asyar.app/extensions/`
6. **Publishing to the Store:**
   The `asyar publish` command handles the full flow — build, package, checksum, GitHub Release, and store submission:
   ```bash
   asyar publish
   ```
   The CLI includes safety guards: it blocks publishing if the build is stale or if the version is already live in the store. The ZIP is structured with files at the root level (not nested):
   ```
   manifest.json
   index.html
   assets/
   ├── index-xyz.js
   └── index-abc.css
   ```

---

## 11. Data Flow Diagrams

### App Startup Sequence
```ascii
+------------+       +-------------+       +--------------+       +-------------------+       +-------+
| Tauri Init | ----> | Rust Setup  | ----> | WebView Load | ----> | SvelteKit Boots   | ----> | Ready |
+------------+       +-------------+       +--------------+       | (appInitializer)  |       +-------+
                                                                  +---------+---------+
                                                                            |
                                                                  +---------v---------+
                                                                  | ExtensionLoader   |
                                                                  | - glob Built-ins  |
                                                                  | - FS Installed    |
                                                                  +-------------------+
```

### Tier 1 Command Execution
```ascii
+------------+       +-------------------+       +-------------------------+
| User Input | ----> |   ResultsList     | ----> |  handleCommandAction()  |
+------------+       | (Select / Enter)  |       |  (extensionManager.ts)  |
                     +-------------------+       +-----------+-------------+
                                                             | navigateToView('ext_id/DefaultView')
+-------------------------+      +-------------------+       |
|    SvelteKit Reacts     | <--- | $activeView Store | <-----+
| (+page.svelte bounds)   |      |      Updates      |
+------------+------------+      +-------------------+
             | (isBuiltIn == true)
+------------v-------------+     +-------------------------+
| getLoadedExtensionModule | --> |  <svelte:component />   |
| (Extracts Svelte Class)  |     | (Mounts in Core DOM)    |
+--------------------------+     +-------------------------+
```

### Tier 2 Command Execution (Isolates)
```ascii
+------------+       +-------------------+       +-------------------------+
| User Input | ----> |   ResultsList     | ----> |  handleCommandAction()  |
+------------+       | (Select / Enter)  |       |  (extensionManager.ts)  |
                     +-------------------+       +-----------+-------------+
                                                             | navigateToView('ext_id/DefaultView')
+-------------------------+      +-------------------+       |
|    SvelteKit Reacts     | <--- | $activeView Store | <-----+
| (+page.svelte bounds)   |      |      Updates      |
+------------+------------+      +-------------------+
             | (isBuiltIn == false)
+------------v-------------+     +-------------------------+
|    <ExtensionIframe>     | --> | Rust URL Intercept      |
| src="asyar-extension://" |     | (stream from AppData)   |
+------------+-------------+     +-----------+-------------+
                                             |
+--------------------------+     +-----------v-------------+
| Extension Context Boots  | <-- |   index.html Injected   |
| (IPC & MessageBroker)    |     |   (Isolated Webview)    |
+--------------------------+     +-------------------------+
```

---

## 12. Authentication & Subscription System

Asyar uses a **feature-entitlement model** to gate premium capabilities. Plans are collections of entitlement strings; the desktop app caches and checks these strings at runtime. No tier names are hardcoded — adding a new subscription tier or moving a feature between tiers requires only an admin panel change, not a code deploy.

### Entitlement Strings

```
sync:settings           — Cloud settings sync
sync:ai-conversations   — Sync AI chat history to cloud
ai:chat                 — Use AI chat features
ai:advanced-models      — Access premium AI models
extensions:premium      — Install premium extensions
```

### Auth Flow (Deep Link)

1. Desktop calls `POST /api/desktop/auth/initiate?provider=github` → receives `{ sessionCode, authUrl }`.
2. `authUrl` is opened in the system browser via `@tauri-apps/plugin-opener`.
3. User completes OAuth on `asyar.org`. The backend generates a Sanctum token with `['desktop', 'sync']` scopes (90-day expiry) and redirects the browser to `asyar://auth/callback?session_code=X`.
4. `tauri-plugin-deep-link` intercepts the `asyar://` URL and emits an `asyar:deep-link` Tauri event.
5. The frontend's `authService` receives the event and calls `auth_poll` (Rust command) which fetches the token + user + entitlements from the backend's session cache.
6. The full auth payload is encrypted (AES-256-GCM, key derived from app data path via Argon2id) and persisted to `auth.dat` via Tauri Store plugin. In-memory `AuthState` is populated.

### Layer Responsibilities

| Layer | Responsibility |
|-------|---------------|
| **Laravel backend** | OAuth flow, token issuance, entitlement resolution (`plan_entitlements` + `entitlement_overrides`), Sanctum token lifecycle |
| **Rust (`src-tauri/src/auth/`)** | Token persistence (encrypted `auth.dat`), in-memory `AuthState`, HTTP API client (`reqwest`), Tauri command wrappers |
| **TS (`authService.svelte.ts`)** | Reactive auth state (`$state`), login/logout flows, background entitlement refresh, offline grace-period logic |
| **TS (`entitlementService.svelte.ts`)** | Synchronous `check(entitlement)` — free tier always allowed, premium gated when logged in |
| **Svelte (`EntitlementGate.svelte`)** | Declarative feature gating — shows upsell overlay when entitlement is missing |
| **Extension SDK** | `EntitlementServiceProxy` exposes `check()` and `getAll()` to Tier 2 extensions via standard IPC (requires `entitlements:read` manifest permission) |

### Offline Behavior

| Scenario | Behavior |
|----------|----------|
| Cached entitlements < 7 days old, network down | Use cached entitlements, log warning |
| Cached entitlements > 7 days old, network down | Clear entitlements, show non-blocking notification |
| Never logged in | All features work (free tier = no restrictions) |

### Token Security

- Token encrypted with AES-256-GCM before writing to `auth.dat`.
- Key derived from the app data directory path using Argon2id — machine-specific, not a secret, but prevents casual file reading.
- On any 401 from the backend, `AuthState` is cleared and the user is prompted to re-authenticate.
- Future: migrate to OS keychain once `tauri-plugin-keychain` stabilizes.

### Backend Tables

| Table | Purpose |
|-------|---------|
| `plans` | Subscription tiers with pricing metadata |
| `plan_entitlements` | Many-to-many: plan → entitlement strings |
| `subscriptions` | User's active subscription, status, payment provider |
| `entitlement_overrides` | Admin-granted per-user entitlements (beta testers, lifetime deals) |

---

## 13. Data Persistence Architecture

Asyar uses two SQLite databases managed by the Rust backend:

| Database | Module | Tables | Purpose |
|---|---|---|---|
| `search_index.db` | `search_engine/mod.rs` | `search_items` | Application and command search index with frecency scoring |
| `asyar_data.db` | `storage/mod.rs` | `clipboard_items`, `snippets`, `shortcuts`, `extension_storage` | User data persistence with row-level CRUD |

Both databases use WAL mode for concurrent read performance and are stored in the platform-specific app data directory.

**`asyar_data.db` tables:**

- **`clipboard_items`** — Clipboard history (up to 1000 items). Each copy/paste is a single `INSERT`, not a full-table rewrite. Indexed on `created_at DESC` and `favorite`.
- **`snippets`** — Text expansion snippets. Row-level upsert/update/delete.
- **`shortcuts`** — Item keyboard shortcuts. Row-level upsert with `object_id` uniqueness.
- **`extension_storage`** — Scoped key-value store for Tier 2 extensions. Composite primary key `(extension_id, key)` ensures data isolation. Cleaned up automatically on extension uninstall.

**Settings, portals, and AI chat** continue to use Tauri plugin-store (JSON files) — their datasets are small and write-infrequent.

---

## 14. Known Limitations & Future Work

1. **Checksum Verification:** The publish pipeline computes SHA-256 checksums for extension ZIPs and stores them in the Asyar Store. The app verifies checksums on download. Cryptographic signature verification (code signing) is not yet implemented — the system relies on HTTPS transport + checksum integrity.
2. **Symlink Support for Dev Tools:** The `asyar link` CLI command creates symlinks from the app data extensions directory to the developer's project. The Rust custom protocol handler resolves symlinks correctly on macOS and Linux. Windows support uses a copy fallback (`asyar link --copy`).
3. **`unsafe-eval` Application Policy:** The iframe Content-Security-Policy currently permits `'unsafe-eval'`. While the Tier 2 execution limits blast radius significantly, this remains a surface area vulnerability for advanced XSS should an extension load untrusted network content internally. Future iterations should aim to disable this entirely for Store-certified extensions once dev workflows standardize on strict pre-evaluation. 
