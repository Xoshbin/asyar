# Asyar Extension Developer's Bible

> **The definitive guide for building, testing, and shipping extensions on the Asyar platform.**

This document is the single source of truth for every developer who builds on Asyar — from a first-time contributor shipping their debut extension to a senior engineer integrating deep system capabilities. Read it cover-to-cover once, then use it as a reference.

---

## Table of Contents

1. [Introduction — The Asyar Ecosystem](#1-introduction--the-asyar-ecosystem)
2. [Prerequisites & Environment Setup](#2-prerequisites--environment-setup)
3. [Quick Start — Hello World in Under 5 Minutes](#3-quick-start--hello-world-in-under-5-minutes)
4. [Architecture — How It All Works](#4-architecture--how-it-all-works)
5. [Extension Lifecycle — Birth to Death](#5-extension-lifecycle--birth-to-death)
6. [The Manifest — Complete Reference](#6-the-manifest--complete-reference)
7. [The Three Extension Types](#7-the-three-extension-types)
8. [The SDK — Every Service Documented](#8-the-sdk--every-service-documented)
9. [Actions — The ⌘K Panel](#9-actions--the-k-panel)
10. [Permissions Reference](#10-permissions-reference)
11. [The "Create Extension" Built-in Tool](#11-the-create-extension-built-in-tool)
12. [Development Workflow — CLI Reference](#12-development-workflow--cli-reference)
13. [Publishing — GitHub & the Asyar Store](#13-publishing--github--the-asyar-store)
14. [Design System & UI Consistency](#14-design-system--ui-consistency)
15. [Best Practices & Performance](#15-best-practices--performance)
16. [Debugging Workflows](#16-debugging-workflows)
17. [Complete Example — Bookmarks Extension](#17-complete-example--bookmarks-extension)
18. [Troubleshooting & FAQ](#18-troubleshooting--faq)

---

## 1. Introduction — The Asyar Ecosystem

Asyar is a macOS launcher and productivity platform. The extension system turns it from a built-in tool into a platform — any developer can add commands, search results, and rich UI panels that feel native to the app.

### What an extension can do

- **Register commands** that appear in the global search bar when the user types a trigger phrase.
- **Return live search results** directly into the launcher as the user types (like a calculator or documentation search).
- **Open a full view panel** rendered as a sandboxed iframe — build menus, data tables, detail pages, and interactive UIs.
- **Show system notifications** via the macOS notification center.
- **Read and write the clipboard**, including the full history managed by Asyar.
- **Make outbound HTTP requests** through the host process (bypassing iframe CSP restrictions).
- **Register keyboard-accessible actions** in the ⌘K Action Drawer — contextual secondary operations.
- **Display live status items** in the macOS tray menu while a background task is running.
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

---

## 2. Prerequisites & Environment Setup

### Runtime requirements

| Requirement | Minimum Version |
|---|---|
| Node.js | 18 or later |
| pnpm | 8 or later (recommended) |
| Asyar app | Installed and running |

### Install the Asyar CLI

The `asyar-sdk` npm package provides both the runtime SDK and the `asyar` CLI used throughout your entire development workflow.

```bash
npm install -g asyar-sdk
```

Verify installation:

```bash
asyar --version
```

### Per-project dependencies

Every extension project needs at minimum:

```bash
pnpm add asyar-sdk svelte
pnpm add -D vite @sveltejs/vite-plugin-svelte typescript
```

The CLI scaffolder installs these automatically. You only need to run this manually if you are setting up a project by hand.

---

## 3. Quick Start — Hello World in Under 5 Minutes

The fastest path to a running extension is the **built-in "Create Extension" tool** inside Asyar. It scaffolds the entire project, installs dependencies, runs the first build, and registers the extension for development — automatically.

### Method A: Using the Create Extension UI (Recommended)

1. Open Asyar (press your configured launch hotkey).
2. Type **"Create Extension"** in the search bar and press Enter.
3. Fill in the form:
   - **Name**: `Hello World`
   - **ID**: `com.yourname.hello-world`
   - **Description**: `A minimal Asyar extension that says hello.`
   - **Save Location**: choose any directory on your machine
   - **Extension Type**: `View` (opens a UI panel)
4. Click **Generate**.

Asyar will:
- Resolve the latest `asyar-sdk` version from npm
- Write all project files from templates
- Run `pnpm install`
- Run `pnpm run build`
- Register your project path in the development registry
- Open VS Code (or your default file manager)

Your extension is **immediately available** in Asyar. Open the launcher, type `Hello World`, press Enter, and the view renders.

> **See [Section 11](#11-the-create-extension-built-in-tool) for the full Create Extension reference, including all three extension types and what each template produces.**

---

### Method B: Manual scaffold

If you prefer full control, here is the minimum project structure:

```
com.yourname.hello-world/
├── manifest.json
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
└── src/
    ├── main.ts
    ├── index.ts
    └── DefaultView.svelte
```

> ⚠️ **`index.html` must be in the project root, not inside `src/`. The validator and Vite both require it there.**

#### `manifest.json`

```json
{
  "id": "com.yourname.hello-world",
  "name": "Hello World",
  "version": "1.0.0",
  "description": "A minimal Asyar extension that says hello.",
  "author": "Your Name",
  "icon": "👋",
  "main": "dist/index.js",
  "searchable": false,
  "type": "view",
  "defaultView": "DefaultView",
  "asyarSdk": "^1.3.3",
  "commands": [
    {
      "id": "open",
      "name": "Open Hello World",
      "description": "Opens the Hello World view",
      "resultType": "view",
      "view": "DefaultView"
    }
  ]
}
```

#### `src/main.ts`

```typescript
import { mount } from 'svelte';
import DefaultView from './DefaultView.svelte';
import { ExtensionContext, type ILogService } from 'asyar-sdk';

// The hostname of the asyar-extension:// URL is always your extension ID.
const extensionId = window.location.hostname || 'com.yourname.hello-world';

// 1. Create ONE context for the entire iframe lifetime.
//    Do NOT create a second one inside a component.
const context = new ExtensionContext();
context.setExtensionId(extensionId);

// 2. Signal readiness to the host. Without this, the host will not
//    route actions or service calls to this iframe.
window.parent.postMessage({ type: 'asyar:extension:loaded', extensionId }, '*');

// 3. Forward ⌘K to the host so the Action Drawer opens from inside the iframe.
window.addEventListener('keydown', (event) => {
  const isCommandK = (event.metaKey || event.ctrlKey) && event.key === 'k';
  if (isCommandK) {
    event.preventDefault();
    window.parent.postMessage({
      type: 'asyar:extension:keydown',
      payload: {
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      }
    }, '*');
  }
});

// 4. Resolve the view from the URL query param.
const viewName = new URLSearchParams(window.location.search).get('view') || 'DefaultView';

// 5. Mount the Svelte component, passing services as props.
if (viewName === 'DefaultView') {
  mount(DefaultView, {
    target: document.getElementById('app')!,
    props: {
      logger: context.getService<ILogService>('LogService'),
    }
  });
}
```

#### `src/DefaultView.svelte`

```svelte
<script lang="ts">
  import type { ILogService } from 'asyar-sdk';

  interface Props {
    logger: ILogService;
  }
  let { logger }: Props = $props();

  let count = $state(0);

  function handleClick() {
    count++;
    logger.info(`Hello World: button clicked ${count} times`);
  }
</script>

<div class="container">
  <h1>Hello from Asyar!</h1>
  <p>Your first extension is running inside a sandboxed iframe.</p>
  <button onclick={handleClick}>
    Clicked {count} times
  </button>
</div>

<style>
  .container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    font-family: system-ui, sans-serif;
    padding: 2rem;
    background: var(--bg-primary);
    color: var(--text-primary);
  }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  p  { opacity: 0.7; margin-bottom: 1.5rem; }
  button {
    background: var(--accent-primary, #2563eb);
    color: white;
    border: none;
    padding: 0.5rem 1.25rem;
    border-radius: 6px;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  button:hover { opacity: 0.85; }
</style>
```

#### `src/index.ts`

```typescript
import type { Extension, ExtensionContext, IExtensionManager } from 'asyar-sdk';
import DefaultView from './DefaultView.svelte';

class HelloWorldExtension implements Extension {
  private extensionManager?: IExtensionManager;

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService<IExtensionManager>('ExtensionManager');
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async viewActivated(viewId: string): Promise<void> {}
  async viewDeactivated(viewId: string): Promise<void> {}

  async executeCommand(commandId: string, args?: Record<string, any>): Promise<any> {
    if (commandId === 'open') {
      this.extensionManager?.navigateToView('com.yourname.hello-world/DefaultView');
      return { type: 'view', viewPath: 'com.yourname.hello-world/DefaultView' };
    }
  }

  onUnload = () => {};
}

export default new HelloWorldExtension();
export { DefaultView };
```

#### `index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Hello World</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

#### `vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath, URL } from 'url';
import { existsSync } from 'fs';
import { resolve } from 'path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const localSdkEntry = resolve(__dirname, '../../asyar-sdk/src/index.ts');

export default defineConfig(({ mode }) => ({
  plugins: [svelte()],
  resolve: {
    // In development, resolve the SDK from source for a faster feedback loop.
    // In production, this alias is absent and the installed npm package is used.
    alias:
      mode === 'development' && existsSync(localSdkEntry)
        ? { 'asyar-sdk': localSdkEntry }
        : undefined,
  },
}));
```

#### `package.json`

```json
{
  "name": "com.yourname.hello-world",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev":      "vite build --watch",
    "build":    "asyar build",
    "validate": "asyar validate",
    "link":     "asyar link",
    "publish":  "asyar publish"
  },
  "dependencies": {
    "asyar-sdk": "^1.3.3",
    "svelte": "^5.0.0"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^5.0.0",
    "typescript": "^5.0.0",
    "vite": "^6.0.0"
  }
}
```

#### Register and run

```bash
# Register the project path with Asyar (only needed for manually created extensions)
asyar link

# Start the file watcher — rebuild on every save
pnpm dev
```

Open Asyar, type `Open Hello World`, press Enter. The panel renders.

---

## 4. Architecture — How It All Works

### The two-tier model

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

**Tier 1 (Built-in Features):** Bundled into the app binary. They run directly in the same SvelteKit host context as Asyar's own UI. They have privileged access to all Tauri APIs and are loaded eagerly at startup via Vite's `import.meta.glob`. Examples: Calculator, Snippets, Shortcuts, AI Chat, Portals, Create Extension.

**Tier 2 (Installed Extensions):** Your extension. Loaded on demand into an isolated `<iframe>`. All communication with the host goes over the SDK's `postMessage` bridge. Discovered from `~/.config/Asyar/extensions/<extensionId>/` on disk.

---

### The IPC bridge — how service calls travel

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

Every service call is asynchronous. There is no synchronous IPC. The `MessageBroker` has a default IPC timeout of 10 seconds — any call that takes longer than the timeout (plus the backend's own timeout) rejects with `"IPC Request timed out"`.

---

### The `asyar-extension://` protocol

When Asyar renders an extension iframe, it loads a URL like:
```
asyar-extension://com.yourname.hello-world/index.html?view=DefaultView
```

The Rust URI scheme handler (`uri_schemes.rs`) resolves this URL to a file with the following priority order:

1. **Dev extensions** — paths registered in `dev_extensions.json` (via `asyar link` or Create Extension). Enables hot-reload during development.
2. **Debug fallback** (debug builds only) — `src/built-in-features/{id}/dist/`.
3. **Built-in resources** — files bundled into the app binary.
4. **Installed extensions** — `$APP_DATA/extensions/{extensionId}/dist/`.

The protocol handler strips query parameters and URL fragments before filesystem lookup. It also has path-traversal protection (`..` segments are rejected).

**Security:** The iframe runs with this sandbox attribute:
```
allow-scripts allow-same-origin allow-forms allow-popups
```

And this Content Security Policy:
```
default-src asyar-extension: 'self';
script-src  asyar-extension: 'unsafe-inline' 'unsafe-eval';
style-src   asyar-extension: 'unsafe-inline';
font-src    asyar-extension:;
img-src     asyar-extension: data:;
```

External URLs in `<script src="">` tags are blocked. All networking goes through `NetworkService`.

---

### The permission system — defense in depth

Permissions are enforced at **two independent layers**:

1. **Frontend IPC router** (`ExtensionIpcRouter.ts`): Before forwarding any postMessage to a Tauri command, checks whether the calling extension's manifest declares the required permission.
2. **Rust permission registry** (`permissions.rs`): A second independent check inside the Rust process.

Both layers must pass. If either rejects, the call returns a structured `{ allowed: false }` error immediately — it never hangs.

---

## 5. Extension Lifecycle — Birth to Death

```
                  App startup
                      │
          ┌─────────────────────┐
          │      DISCOVERY      │
          │                     │
          │  Rust scans 3 dirs: │
          │  1. dev_extensions  │
          │  2. built-in feats  │
          │  3. installed exts  │
          │                     │
          │  Reads manifest.json│
          │  Validates semver   │
          │  compat checks      │
          └──────────┬──────────┘
                     │ manifest loaded
          ┌──────────▼──────────┐
          │    MANIFEST LOADED  │
          │    (idle state)     │
          │                     │
          │  Registered in      │
          │  ExtensionBridge.   │
          │  Commands indexed.  │
          │  Permissions synced │
          │  to Rust registry.  │
          │                     │
          │  For searchable:    │
          │  background iframe  │
          │  spawned silently.  │
          └──────────┬──────────┘
                     │ user invokes command
          ┌──────────▼──────────┐
          │     INITIALIZE      │
          │                     │
          │  Iframe created.    │
          │  asyar-extension:// │
          │  URL loaded.        │
          │                     │
          │  main.ts runs:      │
          │  - ExtensionContext │
          │  - setExtensionId() │
          │  - postMessage      │
          │    'loaded' signal  │
          └──────────┬──────────┘
                     │ host receives 'loaded' signal
          ┌──────────▼──────────┐
          │      ACTIVATE       │
          │                     │
          │  extension.activate()
          │  Svelte component   │
          │  mounts in iframe.  │
          │  Actions registered.│
          └──────────┬──────────┘
                     │
          ┌──────────▼──────────┐
          │      ACTIVE         │
          │                     │
          │  User interacts.    │
          │  Services available.│
          │                     │
          │  Incoming events:   │
          │  - search queries   │
          │  - view:search      │
          │  - view:submit      │
          │  - keydown fwds     │
          │  - command invokes  │
          │  - action:execute   │
          └──────────┬──────────┘
                     │ user closes view
          ┌──────────▼──────────┐
          │     DEACTIVATE      │
          │                     │
          │  extension.deactivate()
          │  onUnload callback  │
          │  Iframe destroyed.  │
          └─────────────────────┘
```

### Compatibility checks at discovery

When Asyar discovers an extension, it validates two version constraints from the manifest:

| Field | Check |
|---|---|
| `asyarSdk` | Compared (semver) against the app's bundled SDK version (`1.2.0` is current). If `required` > `supported`, the extension is marked `SdkMismatch` and will not load. |
| `minAppVersion` | Compared against the app's version. If the app is too old, the extension is marked `AppVersionTooOld`. |

If neither field is present, the extension is marked `Unknown` (compatible by default).

---

## 6. The Manifest — Complete Reference

`manifest.json` lives in the project root alongside `index.html`. All fields are listed below.

### Root-level fields

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `id` | `string` | ✅ | Regex: `/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/` | Reverse-domain unique identifier. **Must exactly match the directory name on disk.** Example: `com.yourname.my-extension` |
| `name` | `string` | ✅ | 2–50 characters | Human-readable display name shown in the launcher. |
| `version` | `string` | ✅ | Valid semver | Used by `asyar publish` for GitHub Release tagging. Increment before each `publish`. |
| `description` | `string` | ✅ | 10–200 characters | Short description shown in the store and launcher. |
| `author` | `string` | ✅ | — | Your name or organization. Shown in the store. |
| `commands` | `array` | ✅ | At least one entry | See [Commands](#7-the-three-extension-types). |
| `permissions` | `string[]` | ❌ | Known strings only | Declare every permission your extension needs. See [Section 10](#10-permissions-reference). |
| `icon` | `string` | ❌ | Emoji or base64 data URI | Default icon for all commands. Command-level icons override this. |
| `defaultView` | `string` | ❌ | — | Component name rendered when no command specifies a `view`. Required if any command has `resultType: "view"` with no `view` field. |
| `type` | `"result" \| "view"` | ❌ | — | Legacy hint. Prefer `resultType` on individual commands. |
| `searchable` | `boolean` | ❌ | — | When `true`, forwards global search queries to your `search()` method and in-view input to `onViewSearch()`/`onViewSubmit()`. |
| `main` | `string` | ❌ | Relative path | Path to the compiled JS class file (e.g. `"dist/index.js"`). **Required if `searchable: true`** — the host imports this file to call `search()`. |
| `minAppVersion` | `string` | ❌ | Valid semver | Minimum Asyar app version. Extension will be marked incompatible if the app is older. |
| `asyarSdk` | `string` | ❌ | Semver range | SDK version requirement (e.g. `"^1.2.0"`). Extension will not load if the bundled SDK is older. |

### ID naming rules

- Format: `reverse.domain.extensionname` — dot-separated segments, each starting with a lowercase letter, followed only by lowercase letters and digits.
- Regex: `/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/`
- **The directory on disk must be named exactly the same as `id`.** Asyar discovers extensions by directory name.
- ✅ Valid: `com.acme.my-tool` → **No**, hyphens are not allowed
- ✅ Valid: `com.acme.mytool`, `io.github.username.extension`, `org.myteam.util`
- ❌ Invalid: `MyExtension`, `com.acme.my-tool`, `com.ACME.tool`

### The `commands` array — per-command fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | ✅ | Unique within the extension. Used as the command's programmatic key. |
| `name` | `string` | ✅ | Display name shown in the launcher when the user searches. |
| `description` | `string` | ✅ | One-line description shown as subtitle. |
| `resultType` | `"view" \| "no-view"` | ✅ | `"view"` opens a panel. `"no-view"` executes silently. |
| `view` | `string` | ❌ | Component name to render for `resultType: "view"`. Falls back to manifest `defaultView`. |
| `icon` | `string` | ❌ | Emoji or base64 data URI. Overrides the extension-level icon. |
| `trigger` | `string` | ❌ | Keyword that triggers this command (legacy field). |

### Complete manifest example

```json
{
  "id": "com.yourname.note-search",
  "name": "Note Search",
  "version": "2.1.0",
  "description": "Search and preview your local Markdown notes.",
  "author": "Jane Dev",
  "icon": "📝",
  "main": "dist/index.js",
  "searchable": true,
  "type": "result",
  "defaultView": "DetailView",
  "asyarSdk": "^1.2.0",
  "minAppVersion": "1.0.0",
  "permissions": ["network", "notifications:send"],
  "commands": [
    {
      "id": "search",
      "name": "Search Notes",
      "description": "Live search your local notes as you type",
      "resultType": "view",
      "view": "DetailView",
      "icon": "🔍"
    },
    {
      "id": "new-note",
      "name": "New Note",
      "description": "Create a new blank note",
      "resultType": "no-view",
      "icon": "✏️"
    }
  ]
}
```

---

## 7. The Three Extension Types

When you use the Create Extension tool, you choose one of three types. Each type has a distinct template and a distinct pattern. Understanding when to use each type is crucial.

### Type 1: View Extension (`view`)

**Use when:** Your extension primarily opens a rich UI panel. A task manager, a media browser, a form, a settings editor.

**How it works:**
1. User types the command name → selects it → presses Enter.
2. Asyar opens an iframe and loads your `index.html?view=DefaultView`.
3. Your Svelte component renders.
4. The user interacts with the UI.

**Manifest template:**
```json
{
  "type": "view",
  "searchable": false,
  "defaultView": "DefaultView",
  "commands": [
    { "id": "open", "name": "Open My Tool", "resultType": "view", "view": "DefaultView" }
  ]
}
```

**`src/index.ts` pattern:**
```typescript
import type { Extension, ExtensionContext, IExtensionManager } from 'asyar-sdk';
import DefaultView from './DefaultView.svelte';

class MyExtension implements Extension {
  private extensionManager?: IExtensionManager;

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService<IExtensionManager>('ExtensionManager');
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async viewActivated(viewId: string): Promise<void> {}
  async viewDeactivated(viewId: string): Promise<void> {}

  async executeCommand(commandId: string): Promise<any> {
    if (commandId === 'open') {
      this.extensionManager?.navigateToView('com.yourname.mytool/DefaultView');
      return { type: 'view', viewPath: 'com.yourname.mytool/DefaultView' };
    }
  }

  onUnload = () => {};
}

export default new MyExtension();
export { DefaultView };
```

---

### Type 2: Result Extension (`result`)

**Use when:** Your extension is fundamentally a search engine over some data — documentation, bookmarks, contacts, files. Users type, see instant results, click a result to open a detail view.

**How it works:**
1. Asyar maintains a **hidden background iframe** for your extension at all times (because `searchable: true` is required).
2. As the user types in the global search bar, Asyar sends an `asyar:search:request` message to your background iframe.
3. Your `search(query)` method returns `ExtensionResult[]`.
4. Results appear directly in the global launcher search results.
5. When the user selects a result, `action()` fires. For Tier 2 (installed) extensions, the `action` closure cannot cross the iframe boundary — Asyar automatically navigates to the `viewPath` in the result instead.

> ⚠️ **The `action` function on `ExtensionResult` is ignored for installed extensions (Tier 2)** because functions cannot be serialized over `postMessage`. Always set `viewPath` on results to control navigation.

**Manifest template:**
```json
{
  "type": "result",
  "searchable": true,
  "main": "dist/index.js",
  "defaultView": "DetailView",
  "commands": [
    { "id": "search", "name": "Search My Data", "resultType": "view", "view": "DetailView" }
  ]
}
```

**`src/index.ts` pattern:**
```typescript
import type {
  Extension, ExtensionContext, ExtensionResult,
  IExtensionManager, ILogService
} from 'asyar-sdk';
import DetailView from './DetailView.svelte';

const ITEMS = [
  { id: '1', title: 'Introduction', subtitle: 'Getting started guide' },
  { id: '2', title: 'API Reference', subtitle: 'Full API documentation' },
];

class MyExtension implements Extension {
  private extensionManager?: IExtensionManager;
  private logger?: ILogService;

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService<IExtensionManager>('ExtensionManager');
    this.logger = context.getService<ILogService>('LogService');
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async viewActivated(viewId: string): Promise<void> {}
  async viewDeactivated(viewId: string): Promise<void> {}

  async search(query: string): Promise<ExtensionResult[]> {
    const q = query.toLowerCase();
    return ITEMS
      .filter(item => !q || item.title.toLowerCase().includes(q))
      .map(item => ({
        score: 1,
        title: item.title,
        subtitle: item.subtitle,
        type: 'view' as const,
        // viewPath is used by Tier 2 extensions to navigate on selection.
        // Pass context via URL params.
        viewPath: `com.yourname.mydocs/DetailView?id=${item.id}`,
        action: () => {
          this.extensionManager?.navigateToView(
            `com.yourname.mydocs/DetailView?id=${item.id}`
          );
        },
      }));
  }

  async executeCommand(commandId: string): Promise<any> {
    if (commandId === 'search') {
      return { type: 'view', viewPath: 'com.yourname.mydocs/DetailView' };
    }
  }

  onUnload = () => {};
}

export default new MyExtension();
export { DetailView };
```

**Reading URL params in the detail view:**
```svelte
<!-- src/DetailView.svelte -->
<script lang="ts">
  const params = new URLSearchParams(window.location.search);
  let itemId = $state(params.get('id') ?? '');
  let title  = $state(params.get('title') ?? 'Detail');
</script>
```

---

### Type 3: Logic Extension (`logic`)

**Use when:** Your extension performs actions but never opens a UI panel — a "copy today's date", a "toggle system theme", a "trigger a webhook" command. The logic runs in the background iframe and communicates results via notifications.

**How it works:**
1. A background iframe loads `index.html` with no view component mounted.
2. The extension listens for `asyar:invoke:command` or `asyar:search:request` messages.
3. It performs work and optionally shows a notification.
4. No view panel ever opens.

**Manifest template:**
```json
{
  "type": "result",
  "searchable": true,
  "main": "dist/index.js",
  "commands": [
    { "id": "run", "name": "Run My Action", "resultType": "no-view" }
  ]
}
```

**`src/main.ts` pattern (no view mounting):**
```typescript
import { ExtensionContext } from 'asyar-sdk';

const extensionId = window.location.hostname || 'com.yourname.myaction';

const context = new ExtensionContext();
context.setExtensionId(extensionId);

// Signal readiness — still required even with no UI.
window.parent.postMessage({ type: 'asyar:extension:loaded', extensionId }, '*');
```

**`src/index.ts` pattern:**
```typescript
import type {
  Extension, ExtensionContext, ExtensionResult,
  ILogService, INotificationService
} from 'asyar-sdk';

class MyLogicExtension implements Extension {
  private logger?: ILogService;
  private notifications?: INotificationService;

  async initialize(context: ExtensionContext): Promise<void> {
    this.logger = context.getService<ILogService>('LogService');
    this.notifications = context.getService<INotificationService>('NotificationService');
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async viewActivated(viewId: string): Promise<void> {}
  async viewDeactivated(viewId: string): Promise<void> {}

  async search(query: string): Promise<ExtensionResult[]> {
    return [
      {
        score: 1,
        title: 'Run My Action',
        subtitle: 'Executes the background action',
        type: 'result' as const,
        action: async () => {
          await this.runAction();
        },
      }
    ];
  }

  private async runAction(): Promise<void> {
    this.logger?.info('Running background action');
    // ... do work ...
    await this.notifications?.notify({ title: 'Done', body: 'Action completed.' });
  }

  async executeCommand(commandId: string): Promise<any> {
    if (commandId === 'run') {
      await this.runAction();
    }
  }

  onUnload = () => {};
}

export default new MyLogicExtension();
```

---

### In-view search (all types)

When your extension's panel is open and `searchable: true`, the Asyar search bar becomes your extension's input field. Two messages are dispatched:

| Message | When fired | Payload |
|---|---|---|
| `asyar:view:search` | On every keystroke | `{ query: string }` |
| `asyar:view:submit` | On Enter key | `{ query: string }` |

**Svelte 5 implementation:**
```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  let query = $state('');
  let results = $state<string[]>([]);

  function handleMessage(event: MessageEvent) {
    if (event.source !== window.parent) return;
    const { type, payload } = event.data;

    if (type === 'asyar:view:search') {
      query = payload?.query ?? '';
      // Filter or search your local data based on query
      results = myData.filter(item => item.includes(query));
    }

    if (type === 'asyar:view:submit') {
      const submitted = payload?.query ?? '';
      if (submitted) handleSubmit(submitted);
    }
  }

  onMount(() => window.addEventListener('message', handleMessage));
  onDestroy(() => window.removeEventListener('message', handleMessage));

  function handleSubmit(value: string) {
    // e.g. send a chat message, run a search
  }
</script>
```

---

## 8. The SDK — Every Service Documented

All services are accessed through `ExtensionContext.getService<T>(serviceName)`. The context is created once in `main.ts` and the extension ID must be set before calling any service.

```typescript
import { ExtensionContext } from 'asyar-sdk';
import type { INotificationService } from 'asyar-sdk';

const context = new ExtensionContext();
context.setExtensionId(extensionId);

const notifications = context.getService<INotificationService>('NotificationService');
```

> ⚠️ **Create exactly one `ExtensionContext` per iframe.** The constructor attaches `focusin`/`focusout` listeners for input-focus tracking. Creating a second context (e.g. inside a Svelte component's `onMount`) attaches duplicate listeners, causes double IPC calls, and can break the ⌘K shortcut detection.

> ⚠️ **Never call `getService()` inside Svelte components.** Resolve services in `main.ts` and pass them as `$props()` to your components. This is the canonical pattern used by all scaffolded templates.

---

### 8.1 `LogService` — Structured logging

**Permission required:** None.

```typescript
interface ILogService {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string | Error): void;
  custom(message: string, category: string, colorName: string, frameName?: string): void;
}
```

**Usage:**
```typescript
const log = context.getService<ILogService>('LogService');

log.debug('Rendering item list');
log.info('Extension initialized');
log.warn('Rate limit approaching');
log.error(new Error('API request failed'));
log.custom('User selected item #3', 'UI', 'cyan', 'MyExtension');
```

Log messages appear in Asyar's developer log panel (accessible from the tray menu).

**Guidelines:**
- Use `debug` freely during development for trace-level output.
- Use `info` for lifecycle events (initialize, activate, first data load).
- Use `warn` for recoverable edge cases (fallback values, deprecated usage).
- Use `error` only for actual failures that affect behavior.
- `custom` lets you add a color and category label for visual grouping in the log panel.

---

### 8.2 `NotificationService` — System notifications

**Permission required:** `notifications:send`

```typescript
interface INotificationService {
  checkPermission(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  notify(options: NotificationOptions): Promise<void>;
  registerActionTypes(actionTypes: NotificationActionType[]): Promise<void>;
  listenForActions(callback: (notification: any) => void): Promise<void>;
  createChannel(channel: NotificationChannel): Promise<void>;
  getChannels(): Promise<any[]>;
  removeChannel(channelId: string): Promise<void>;
}

type NotificationOptions = {
  title: string;
  body: string;
  icon?: string;
  channelId?: string;
  attachments?: Array<{ id: string; url: string }>;
};

type NotificationChannel = {
  id: string;
  name: string;
  description: string;
  importance?: 0 | 1 | 2 | 3 | 4; // None → High
  visibility?: -1 | 0 | 1;         // Secret, Private, Public
  lights?: boolean;
  lightColor?: string;
  vibration?: boolean;
  sound?: string;
};

type NotificationActionType = {
  id: string;
  actions: Array<{
    id: string;
    title: string;
    requiresAuthentication?: boolean;
    foreground?: boolean;
    destructive?: boolean;
    input?: boolean;
    inputButtonTitle?: string;
    inputPlaceholder?: string;
  }>;
};
```

**Usage:**
```typescript
const notif = context.getService<INotificationService>('NotificationService');

// 1. Check and request permission (do this once during initialize/activate)
const granted = await notif.checkPermission();
if (!granted) await notif.requestPermission();

// 2. Send a basic notification
await notif.notify({ title: 'Export Complete', body: 'Saved to Desktop.' });

// 3. Create a notification channel (groups related notifications)
await notif.createChannel({
  id: 'com.yourname.ext:updates',
  name: 'Extension Updates',
  description: 'Notifications about data sync status',
  importance: 3, // Default
});

// 4. Send to a specific channel
await notif.notify({
  title: 'Sync Complete',
  body: '42 items updated.',
  channelId: 'com.yourname.ext:updates',
});

// 5. Register actionable notification types (reply buttons etc.)
await notif.registerActionTypes([{
  id: 'SYNC_RESULT',
  actions: [{ id: 'view', title: 'View Details' }],
}]);

// 6. Listen for action button clicks
await notif.listenForActions((notification) => {
  if (notification.actionTypeId === 'SYNC_RESULT' && notification.actionId === 'view') {
    // open your extension view
  }
});
```

---

### 8.3 `ClipboardHistoryService` — Full clipboard access

**Permission required:** `clipboard:read` for reads, `clipboard:write` for writes.

```typescript
interface IClipboardHistoryService {
  // Read
  readCurrentClipboard(): Promise<{ type: ClipboardItemType; content: string }>;
  getRecentItems(limit?: number): Promise<ClipboardHistoryItem[]>;

  // Write
  writeToClipboard(item: ClipboardHistoryItem): Promise<void>;
  pasteItem(item: ClipboardHistoryItem): Promise<void>;
  simulatePaste(): Promise<boolean>;

  // Manage history
  toggleItemFavorite(itemId: string): Promise<boolean>;
  deleteItem(itemId: string): Promise<boolean>;
  clearNonFavorites(): Promise<boolean>;

  // Utilities
  formatClipboardItem(item: ClipboardHistoryItem): string;
  normalizeImageData(content: string): string;
  isValidImageData(content: string): boolean;
  initialize(): Promise<void>;
  stopMonitoring(): void;
  hideWindow(): Promise<void>;
}

// Clipboard item types
enum ClipboardItemType {
  Text  = 'text',
  Html  = 'html',
  Image = 'image',
}

interface ClipboardHistoryItem {
  id: string;
  type: ClipboardItemType;
  content?: string;
  preview?: string;
  createdAt: number;
  favorite: boolean;
}
```

**Usage:**
```typescript
const clip = context.getService<IClipboardHistoryService>('ClipboardHistoryService');

// Read what is currently on the clipboard
const current = await clip.readCurrentClipboard();
if (current.type === 'text') {
  console.log(current.content);
}

// Get the 20 most recent clipboard history items
const items = await clip.getRecentItems(20);

// Write a new text item to the clipboard
await clip.writeToClipboard({
  id: crypto.randomUUID(),
  type: ClipboardItemType.Text,
  content: 'Hello from my extension',
  createdAt: Date.now(),
  favorite: false,
});

// Paste an item by simulating keyboard paste
await clip.pasteItem(items[0]);

// Favorite/unfavorite an item (survives clearNonFavorites)
const isFavorite = await clip.toggleItemFavorite(items[0].id);

// Delete a specific item
await clip.deleteItem(items[0].id);

// Check if a content string is valid base64 image data
if (clip.isValidImageData(someContent)) {
  const normalized = clip.normalizeImageData(someContent);
}
```

---

### 8.4 `NetworkService` — Outbound HTTP requests

**Permission required:** `network`

```typescript
interface INetworkService {
  fetch(url: string, options?: RequestOptions): Promise<NetworkResponse>;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  body?: string;
  timeout?: number; // milliseconds, default 30000
}

interface NetworkResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;  // Always a string. Binary responses are base64-encoded.
  ok: boolean;   // true when status is 200-299
}
```

**Usage:**
```typescript
const network = context.getService<INetworkService>('NetworkService');

// GET request
const res = await network.fetch('https://api.example.com/data');
if (res.ok) {
  const data = JSON.parse(res.body);
}

// POST with JSON
const created = await network.fetch('https://api.example.com/items', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({ name: 'My Item', value: 42 }),
  timeout: 10_000,
});

// Handle errors
if (!created.ok) {
  throw new Error(`HTTP ${created.status}: ${created.statusText}`);
}
```

> ⚠️ **Never use `window.fetch()` or `XMLHttpRequest` directly inside your extension.** The iframe's Content Security Policy blocks all external requests (`default-src asyar-extension: 'self'`). Always route HTTP calls through `NetworkService`. Declare `"network"` in your `manifest.json` permissions.

**Timeout behaviour:** The `timeout` option (default 30 000 ms) controls how long the Rust backend waits for the remote server. The SDK adds an IPC-level timeout on top of this. The promise will always resolve or reject — it will never hang indefinitely.

---

### 8.5 `SettingsService` — Persistent key-value storage

**Permission required:** None (namespaced to your extension's section).

```typescript
interface ISettingsService {
  get<T>(section: string, key: string): Promise<T>;
  set<T>(section: string, key: string, value: T): Promise<void>;
  onChanged<T>(section: string, callback: (settings: T) => void): () => void;
}
```

**Usage:**
```typescript
const settings = context.getService<ISettingsService>('SettingsService');

// Read a setting (with TypeScript type inference)
const theme = await settings.get<string>('com.yourname.myext', 'theme');
const count = await settings.get<number>('com.yourname.myext', 'itemCount');

// Write a setting
await settings.set('com.yourname.myext', 'theme', 'dark');
await settings.set('com.yourname.myext', 'lastUsed', Date.now());

// Subscribe to changes (reactive — fires when value changes from any source)
const unsubscribe = settings.onChanged<{ theme: string }>(
  'com.yourname.myext',
  (newSettings) => {
    console.log('Theme changed to:', newSettings.theme);
  }
);

// Call the returned function to stop listening
unsubscribe();
```

> **Pro Tip:** Use `SettingsService` for user preferences that persist across sessions. For transient local state, `localStorage` works fine inside the iframe (scoped to the `asyar-extension://` origin). For complex data structures, use `localStorage` with `JSON.stringify/parse` or store serialized data via `SettingsService`.

---

### 8.6 `StatusBarService` — Tray menu live items

**Permission required:** None.

Register live-updating items in the Asyar macOS tray menu. Perfect for timers, background sync status, or any metric you want always visible.

```typescript
interface IStatusBarItem {
  id: string;
  icon?: string;   // Emoji or short symbol
  text: string;    // Display text (e.g. "18:32", "Syncing...")
}

interface IStatusBarService {
  registerItem(item: IStatusBarItem): void;
  updateItem(id: string, updates: Partial<Pick<IStatusBarItem, 'icon' | 'text'>>): void;
  unregisterItem(id: string): void;
}
```

**Usage:**
```typescript
const statusBar = context.getService<IStatusBarService>('StatusBarService');

// Register a timer item
statusBar.registerItem({ id: 'pomodoro-timer', icon: '🍅', text: '25:00' });

// Update on each tick
statusBar.updateItem('pomodoro-timer', { text: '24:59' });

// Change phase
statusBar.updateItem('pomodoro-timer', { icon: '☕', text: '05:00' });

// Remove when idle
statusBar.unregisterItem('pomodoro-timer');
```

When a user clicks a tray item registered by your extension, Asyar opens the launcher and navigates to your extension's `defaultView`. Ensure `defaultView` is set in your manifest for click-to-navigate to work.

---

### 8.7 `CommandService` — Runtime command registration

**Permission required:** None.

Register command handlers programmatically at runtime (as opposed to statically via the manifest). This is an advanced API for extensions that need to create or modify commands after initialization.

```typescript
interface ICommandService {
  registerCommand(
    commandId: string,
    handler: CommandHandler,
    extensionId: string,
    actions?: Omit<ExtensionAction, 'extensionId'>[]
  ): void;
  unregisterCommand(commandId: string): void;
  executeCommand(commandId: string, args?: Record<string, any>): Promise<any>;
  getCommands(): string[];
  getCommandsForExtension(extensionId: string): string[];
  clearCommandsForExtension(extensionId: string): void;
}
```

---

### 8.8 `ActionService` — ⌘K action registration

**Permission required:** None.

See [Section 9](#9-actions--the-k-panel) for the complete guide.

```typescript
interface IActionService {
  registerAction(action: ExtensionAction): void;
  unregisterAction(actionId: string): void;
  getActions(context?: ActionContext): ExtensionAction[];
  executeAction(actionId: string): Promise<void>;
  setContext(context: ActionContext, data?: { commandId?: string }): void;
  getContext(): ActionContext;
}
```

---

### 8.9 `ExtensionManager` — Navigation and panel control

**Permission required:** None.

The most commonly used service. Controls panel navigation, view labels, and status messages.

```typescript
interface IExtensionManager {
  navigateToView(viewPath: string): void;
  goBack(): void;
  setActiveViewActionLabel(label: string | null): void;
  setActiveViewStatusMessage(message: string | null): void;
  reloadExtensions(): Promise<void>;
  getAllExtensions(): Promise<any[]>;
  uninstallExtension(extensionId: string, extensionName: string): Promise<boolean>;
  searchAll(query: string): Promise<ExtensionResult[]>;
  isExtensionEnabled(extensionName: string): boolean;
  toggleExtensionState(extensionName: string, enabled: boolean): Promise<boolean>;
}
```

**Usage:**
```typescript
const manager = context.getService<IExtensionManager>('ExtensionManager');

// Navigate to a view — format: "<extensionId>/<ViewComponentName>"
manager.navigateToView('com.yourname.myext/DetailView');

// Navigate with context via URL params
manager.navigateToView('com.yourname.myext/DetailView?id=42&title=My+Item');

// Go back to the previous view (or to the search results if at root)
manager.goBack();

// Update the label shown in the bottom-right action bar
manager.setActiveViewActionLabel('Save Note');
manager.setActiveViewActionLabel(null); // clear

// Show a temporary status message in the bottom-left (useful during async ops)
manager.setActiveViewStatusMessage('⏳ Syncing...');
manager.setActiveViewStatusMessage(null); // clear after done
```

**View navigation format:**

The `viewPath` string follows the pattern `<extensionId>/<ViewComponentName>`. The host translates this to:
```
asyar-extension://<extensionId>/index.html?view=<ViewComponentName>
```

Any additional `?key=value` parameters you append to `viewPath` are passed through to the iframe URL and are readable via `new URLSearchParams(window.location.search)`.

---

### Full service reference summary

| Service Name | Interface | Permission | Primary Use |
|---|---|---|---|
| `LogService` | `ILogService` | None | Structured debug/info/warn/error logging |
| `NotificationService` | `INotificationService` | `notifications:send` | System notification center |
| `ClipboardHistoryService` | `IClipboardHistoryService` | `clipboard:read/write` | Full clipboard access and history |
| `NetworkService` | `INetworkService` | `network` | Outbound HTTP requests |
| `SettingsService` | `ISettingsService` | None | Persistent key-value storage |
| `StatusBarService` | `IStatusBarService` | None | Tray menu live items |
| `CommandService` | `ICommandService` | None | Runtime command registration |
| `ActionService` | `IActionService` | None | ⌘K Action Drawer |
| `ExtensionManager` | `IExtensionManager` | None | Navigation, panel control |

---

## 9. Actions — The ⌘K Panel

Actions are keyboard-accessible commands that appear in Asyar's Action Drawer when the user presses **⌘K**. They are **contextual** — what appears depends on where the user is and what your extension has registered.

### What actions are for

Use actions for secondary operations relevant while the user is looking at your view: "Refresh", "Export CSV", "Toggle Filter", "Clear All", "Copy Link". They complement, rather than replace, the UI controls inside your view.

### How the execute function survives the iframe boundary

The `execute` function is a live JavaScript closure. It **cannot be serialized over postMessage**. The SDK uses a two-registry approach:

1. When you call `registerAction({ id, ..., execute })`, the SDK stores the closure locally in the iframe's `ExtensionBridge.actionRegistry`. Only the metadata (`id`, `title`, `icon`, etc.) is sent to the host.
2. When the user activates an action from the ⌘K Drawer, the host sends `asyar:action:execute` to the correct iframe.
3. The SDK receives the message, looks up the `execute` closure in `actionRegistry`, and calls it.

### Registering actions

Register actions after your view is mounted:

```typescript
import { ActionContext, ActionCategory } from 'asyar-sdk';
import type { IActionService, ExtensionAction } from 'asyar-sdk';

const actionService = context.getService<IActionService>('ActionService');

const refreshAction: ExtensionAction = {
  id: 'com.yourname.myext:refresh',   // Must be globally unique. Use your ext ID as namespace.
  title: 'Refresh',
  description: 'Re-fetch data from source',
  icon: '↻',
  extensionId: 'com.yourname.myext',
  category: ActionCategory.PRIMARY,
  context: ActionContext.EXTENSION_VIEW,
  execute: async () => {
    await loadData();
  },
};

actionService.registerAction(refreshAction);
```

### Svelte 5 lifecycle pattern — register and cleanup

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ActionContext, ActionCategory } from 'asyar-sdk';
  import type { IActionService } from 'asyar-sdk';

  interface Props {
    actionService: IActionService;
  }
  let { actionService }: Props = $props();

  const ACTION_ID = 'com.yourname.myext:refresh';

  onMount(() => {
    actionService.registerAction({
      id: ACTION_ID,
      title: 'Refresh',
      description: 'Reload the data',
      icon: '↻',
      extensionId: 'com.yourname.myext',
      category: ActionCategory.PRIMARY,
      context: ActionContext.EXTENSION_VIEW,
      execute: () => reload(),
    });
  });

  // Critical: always unregister on unmount.
  // If you leave actions registered, they pollute the ⌘K panel for other views.
  onDestroy(() => {
    actionService.unregisterAction(ACTION_ID);
  });

  function reload() { /* ... */ }
</script>
```

> ⚠️ **Always unregister actions when the view unmounts.** Registered actions survive view navigation. If you forget `onDestroy` cleanup, your actions accumulate and appear in the ⌘K drawer for completely unrelated views.

> ⚠️ **Pass the bare action ID to `unregisterAction()`** — the exact string you passed to `id` in `registerAction`. Do not add any prefix.

### Action field reference

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | ✅ | Globally unique. Namespace with your extension ID: `com.yourname.ext:action-name` |
| `title` | `string` | ✅ | Label shown in the Action Drawer. |
| `extensionId` | `string` | ✅ | Your extension's `id` from `manifest.json`. |
| `execute` | `() => void \| Promise<void>` | ✅ | Called when the user activates the action. |
| `description` | `string` | ❌ | Secondary text shown below the title. |
| `icon` | `string` | ❌ | Emoji shown next to the title. |
| `category` | `string` | ❌ | Group label. Use `ActionCategory` constants for standard groups. |
| `context` | `ActionContext` | ❌ | When this action is visible. Default: always visible. |

### Action context reference

| `ActionContext` | When shown |
|---|---|
| `GLOBAL` | Always — regardless of what's open |
| `EXTENSION_VIEW` | Only while an extension panel is open |
| `SEARCH_VIEW` | While the main search result list is active |
| `RESULT` | When a specific result item is highlighted |
| `COMMAND_RESULT` | After a command has returned a result |
| `CORE` | Built-in Asyar actions — do not use in extensions |

### Standard action categories

| Constant | Display String | Use for |
|---|---|---|
| `ActionCategory.PRIMARY` | Primary | Main operations for the current view |
| `ActionCategory.NAVIGATION` | Navigation | Opening views, going back, drill-down |
| `ActionCategory.EDIT` | Edit | Create, update, delete operations |
| `ActionCategory.SHARE` | Share | Export, copy to clipboard, send |
| `ActionCategory.DESTRUCTIVE` | Destructive | Irreversible actions — delete, clear, reset |
| `ActionCategory.SYSTEM` | System | Reserved for built-in Asyar actions |

Custom category strings are fully supported — use them for domain-specific grouping.

---

## 10. Permissions Reference

Declare every permission your extension needs in `manifest.json`:

```json
{
  "permissions": ["network", "notifications:send", "clipboard:read"]
}
```

### Full permissions table

| Permission | What it unlocks | SDK methods that require it |
|---|---|---|
| `network` | Outbound HTTP requests | `NetworkService.fetch()` |
| `notifications:send` | System notification center | `NotificationService.notify()`, `.checkPermission()`, `.requestPermission()`, `.registerActionTypes()`, `.listenForActions()`, `.createChannel()` |
| `clipboard:read` | Read clipboard content and history | `ClipboardHistoryService.readCurrentClipboard()`, `.getRecentItems()` |
| `clipboard:write` | Write and manipulate clipboard | `ClipboardHistoryService.writeToClipboard()`, `.pasteItem()`, `.simulatePaste()`, `.toggleItemFavorite()`, `.deleteItem()`, `.clearNonFavorites()` |
| `store:read` | Read from key-value store | Future `StoreService.get()` |
| `store:write` | Write to key-value store | Future `StoreService.set()`, `.delete()` |
| `fs:read` | Read files from the filesystem | Future `FileService.read()`, `.list()` |
| `fs:write` | Write files to the filesystem | Future `FileService.write()`, `.delete()` |
| `shell:execute` | Execute shell commands | Future `ShellService.execute()`; also gates `asyar:api:invoke` |
| `shell:open-url` | Open a URL in the system browser | `window.parent.postMessage({ type: 'asyar:api:opener:open', url })` |

### What happens if a permission is missing

When your extension calls a method that requires an undeclared permission, the host's permission gate intercepts the `postMessage` before it reaches any service implementation. The gate returns a structured error immediately:

```typescript
// Attempting to call notify() without "notifications:send" in manifest:
try {
  await notif.notify({ title: 'Hi', body: 'World' });
} catch (err) {
  // err.message: 'Extension "com.yourname.ext" called "asyar:api:notification:notify"
  //               but did not declare permission "notifications:send" in its manifest.json'
}
```

The extension is **not suspended or crashed** — it continues running. Only that specific blocked call fails.

### Principle of least privilege

Only declare permissions you actually use. Reviewers inspect the permissions list during store review and will reject extensions with undeclared or unnecessary permissions.

---

## 11. The "Create Extension" Built-in Tool

The fastest and most reliable way to scaffold a new extension is the **Create Extension** feature built into Asyar itself. It is available as a command in the launcher.

### How to open it

Open Asyar → type **"Create Extension"** → press Enter.

### The three scaffolded types

| Type | Template produces | Best for |
|---|---|---|
| **View** | `main.ts` + `DefaultView.svelte` + view manifest | Rich UI panels, forms, browsers, editors |
| **Result** (Search + View) | `main.ts` + `index.ts` (with `search()`) + `DetailView.svelte` | Documentation search, contact lookup, file search |
| **Logic** | `main.ts` only (no Svelte component) | Background actions, clipboard tools, webhooks |

### What the scaffolder does

1. **Prompts you** for: name, ID, description, save location, extension type.
2. **Resolves the latest SDK version** from the npm registry (`npm view asyar-sdk version`). Falls back to `^1.3.3` if offline.
3. **Writes all project files** from templates, replacing `{{EXTENSION_NAME}}`, `{{EXTENSION_ID}}`, `{{EXTENSION_DESC}}`, and `{{SDK_VERSION}}` placeholders.
4. **Runs `pnpm install`** to install all dependencies.
5. **Runs `pnpm run build`** to produce the initial `dist/`.
6. **Calls `register_dev_extension`** — stores your project path in `dev_extensions.json` so Asyar resolves the `asyar-extension://` protocol to your local directory. **No `asyar link` needed**.
7. **Opens VS Code** (or falls back to your default file manager).

After generation, your extension is **immediately active** in Asyar. Open the launcher, type your command name, press Enter.

### Template file reference

Every scaffolded project includes these files:

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest (type-specific template) |
| `package.json` | npm/pnpm project with build scripts |
| `vite.config.ts` | Vite build config with SDK alias for dev mode |
| `tsconfig.json` | TypeScript config |
| `index.html` | Vite entry point HTML |
| `.gitignore` | Ignores `node_modules/`, `dist/`, `.env`, `*.zip` |
| `src/main.ts` | iframe bootstrap — creates `ExtensionContext`, signals readiness, mounts component |
| `src/index.ts` | Extension class (view and result types) |
| `src/DefaultView.svelte` | View component (view type) |
| `src/DetailView.svelte` | Detail view component (result type) |

---

## 12. Development Workflow — CLI Reference

### Available CLI commands

| Command | Description |
|---|---|
| `asyar validate` | Validate `manifest.json` against all rules |
| `asyar build` | Validate + run `vite build` + verify output |
| `asyar dev` | Validate + build + link + watch for changes |
| `asyar link` | Build + create symlink in Asyar's extensions directory |
| `asyar link --watch` | `link` + continuous file watching and rebuild |
| `asyar publish` | Full publish pipeline (validate → build → GitHub → Store) |

---

### `asyar validate`

Checks your manifest against all validation rules. Prints a pass/fail report. Safe to run any time.

```bash
asyar validate
```

**What it checks:**

| Check | Rule |
|---|---|
| `id` present and format | Required; must match `/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/` |
| `name` | Required; 2–50 characters |
| `version` | Required; valid semver |
| `description` | Required; 10–200 characters |
| `author` | Required |
| `commands` | At least one entry |
| Each command `id`, `name`, `resultType` | Required |
| `resultType` values | Must be `"view"` or `"no-view"` |
| `view` when `resultType: "view"` | Required unless manifest has `defaultView` |
| `permissions` values | Each must be a recognized permission string |
| `index.html` at project root | Must exist |
| `vite.config.ts` or `.js` | Must exist |

---

### `asyar build`

Validates the manifest, runs `vite build`, and verifies `dist/index.html` was produced.

```bash
asyar build

# Skip validation (e.g. in CI where validate already ran)
asyar build --skip-validate
```

**Bundle size note:** Every dependency — including Svelte, any component library, utility packages — is bundled into `dist/`. There is no shared runtime. Do not mark Svelte as external in Vite config; it must be included in the bundle.

---

### `asyar dev` — active development mode (recommended)

```bash
asyar dev
```

1. Validates the manifest.
2. Runs an initial `vite build`.
3. Creates a symlink in the Asyar extensions directory (if needed).
4. Watches `src/` for changes and rebuilds on every save.

Every successful rebuild is live in Asyar the next time you open the extension panel (the iframe loads fresh on each open).

> **If you used "Create Extension"** to scaffold your project, the dev path is already registered and step 3 is a no-op. Just run `pnpm dev` (which calls `vite build --watch`).

---

### `asyar link` — manual registration

Use this when you **manually cloned** an extension from GitHub and its path is not registered with Asyar.

```bash
asyar link
```

1. Runs `vite build`.
2. Creates a symlink from `~/.config/Asyar/extensions/<id>/` pointing to your project root. Falls back to a directory copy on Windows or if symlink creation fails.

With a symlink in place, subsequent `vite build` runs are immediately reflected. You do not need to run `asyar link` again after each rebuild.

```bash
# Watch mode: rebuild + re-link on every change
asyar link --watch
```

---

### Development loop (daily workflow)

```bash
# Terminal — start Vite in watch mode
pnpm dev   # or: vite build --watch

# Asyar — test your changes
# Close the extension panel → re-open it → changes are live
```

There is no hot-module-replacement inside the iframe — you need to re-open the panel to load the new `dist/`. For most UI iteration this is instant (Vite rebuilds in < 1s for small projects).

---

## 13. Publishing — GitHub & the Asyar Store

### The full publish pipeline

```bash
asyar publish
```

The publish command is a **resumable multi-step pipeline**. Each step is idempotent — if a step already completed in a previous run, the command detects this and skips forward.

#### Step 1 — Validate

Runs `asyar validate`. Exits immediately on failure before touching GitHub or the Store.

#### Step 2 — Build

Runs `vite build` automatically. Verifies `dist/index.html` was produced.

#### Step 3 — Authenticate with the Asyar Store

Sign in via **GitHub OAuth device flow**. Your browser opens to `github.com/login/device` with a code shown in the terminal. After authorization, a store token is stored locally and reused in future runs.

#### Step 4 — Resolve the GitHub repository

The command finds your repository in this priority order:

1. `--repo <url>` flag (explicit override).
2. `git remote get-url origin` (if git remote exists in working directory).
3. `~/.asyar/config.json` (stored from a previous publish run).
4. **Auto-creates a new public GitHub repository** named `asyar-<last-segment-of-id>-extension`.

#### Step 5 — Check for existing release

Queries GitHub for a release with tag `v<version>`. If both the release and its zip asset already exist, the command jumps directly to Step 8.

#### Step 6 — Package

Creates a zip from `dist/` and `manifest.json`. Computes a **SHA-256 checksum** for integrity verification.

#### Step 7 — Create GitHub Release

Creates a GitHub Release tagged `v<version>` and uploads the zip as a release asset.

#### Step 8 — Submit to the Asyar Store

Sends to the Store API: repo URL, extension ID, version, release tag, download URL, and checksum.

#### Step 9 — Review

Your extension enters a review queue. When approved, it appears in the Asyar Store for users to discover and install.

---

### Publishing a new version

1. Bump the version in `manifest.json` (must be a higher semver than the current published version):

```json
{ "version": "1.2.0" }
```

2. Run `asyar publish`. The command creates a new GitHub Release with tag `v1.2.0` and submits a new store entry.

---

### Using a specific GitHub repository

```bash
asyar publish --repo https://github.com/yourusername/your-extension-repo
```

---

### What store reviewers check

- Manifest completeness and valid permissions.
- The extension does what its description says.
- No malicious code, unexpected data collection, or unnecessary permissions.
- Extension builds cleanly from the published source.
- No undeclared or excessive permissions.
- Description and name comply with store guidelines.

---

### Publishing to GitHub without the Store

You can distribute extensions directly via GitHub without going through the Store. Users can install from a direct URL:

```
https://github.com/<user>/<repo>/releases/download/v1.0.0/<extension-id>.zip
```

---

## 14. Design System & UI Consistency

Asyar exposes a set of CSS custom properties that your extension can use to match the app's visual design across light/dark mode changes. Using these variables ensures your extension feels native and adapts to the user's theme automatically.

### Available CSS custom properties

```css
/* Backgrounds */
--bg-primary           /* Main panel background */
--bg-secondary         /* Secondary surfaces, cards */
--bg-tertiary          /* Input fields, subtle areas */

/* Text */
--text-primary         /* Main body text */
--text-secondary       /* Subtitles, supporting text */

/* Interactive */
--accent-primary       /* Primary actions, selected states */
--accent-secondary     /* Hover states, secondary actions */

/* Structure */
--separator            /* Dividers, borders */
```

**Usage in Svelte:**
```svelte
<div class="card">
  <h2>My Extension</h2>
  <p>Content here</p>
</div>

<style>
  .card {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--separator);
    border-radius: 8px;
    padding: 1rem;
  }
  h2 { color: var(--text-primary); }
  p  { color: var(--text-secondary); }
</style>
```

**Usage with Tailwind (arbitrary values):**
```svelte
<div class="bg-[var(--bg-primary)] text-[var(--text-primary)] border-[var(--separator)]">
```

---

## 15. Best Practices & Performance

### Do

- **Resolve services in `main.ts`, pass as props.** Never call `getService()` inside Svelte components.
- **Create exactly one `ExtensionContext` per iframe.** Creating more than one attaches duplicate event listeners.
- **Always unregister actions in `onDestroy`.** Leftover actions pollute the ⌘K drawer for other views.
- **Set `viewPath` on search results.** The `action` closure is ignored for installed extensions; `viewPath` is what actually controls navigation.
- **Bundle everything.** Svelte's runtime, component libraries, utility packages — all of it must be in `dist/`.
- **Use `logger.debug()` aggressively during development.** Strip or convert to `logger.info()` before publishing.
- **Use `var(--bg-primary)` and friends** for all background and text colors to support light/dark theming.
- **Validate before publishing.** `asyar validate` catches manifest errors before they reach reviewers.

### Don't

- **Don't use `window.fetch()` or `XMLHttpRequest`.** The iframe CSP blocks all external requests. Use `NetworkService`.
- **Don't use `<script src="https://...">` CDN tags.** Blocked by CSP. Bundle all dependencies locally.
- **Don't request permissions you don't use.** Reviewers will reject extensions with unnecessary permissions.
- **Don't create a second `ExtensionContext`.** One per iframe — period.
- **Don't call `getService()` inside reactive blocks or component constructors.** Always resolve in `main.ts`.
- **Don't rely on the `action` function for result navigation** (Tier 2). Use `viewPath` instead.

### Performance tips

**Small bundles:** Avoid heavy dependencies. Prefer lightweight libraries. Use `vite-bundle-visualizer` to inspect what is contributing to bundle size.

**Background iframes:** Every `searchable: true` extension always has a background iframe running. If your `search()` method does expensive work, cache aggressively and debounce internally.

**Lazy loading views:** For multi-view extensions, `main.ts` is loaded once. Only mount the component for the current `?view=` parameter. Avoid importing all views at the top of `main.ts` if they are large:

```typescript
// main.ts — conditional import for large views
const viewName = new URLSearchParams(window.location.search).get('view');

if (viewName === 'LargeView') {
  const { default: LargeView } = await import('./LargeView.svelte');
  mount(LargeView, { target: document.getElementById('app')!, props: { ... } });
} else {
  const { default: DefaultView } = await import('./DefaultView.svelte');
  mount(DefaultView, { target: document.getElementById('app')!, props: { ... } });
}
```

**StatusBar updates:** The `updateItem()` method is safe to call on every timer tick. Updates are debounced internally.

---

## 16. Debugging Workflows

### Step 1 — Check the Asyar developer log

Open Asyar → tray menu → **Developer Log**. All `LogService` calls from your extension appear here with timestamps, categories, and colors. This is the primary debugging interface.

### Step 2 — Open browser DevTools for the iframe

Asyar is built on Tauri/WebKit. You can open WebKit Inspector for the extension iframe:

1. Enable developer mode in Asyar settings.
2. Right-click inside your extension's view → **Inspect Element**.
3. The full WebKit DevTools open for your iframe's context.

From DevTools you can:
- Inspect the DOM, styles, and layout.
- Use the Console to run JavaScript in your extension's context.
- Set breakpoints in the Sources panel.
- Monitor the Network tab (note: `window.fetch()` is blocked, but SDK-routed calls show in the Console logs).

### Step 3 — Watch the raw IPC messages

All messages between your iframe and the host travel as `postMessage` events. In DevTools Console:

```javascript
// Monitor incoming messages (from host)
window.addEventListener('message', (e) => console.log('[IPC IN]', e.data));

// Monitor outgoing messages (to host) — patch the postMessage call
const _orig = window.parent.postMessage.bind(window.parent);
window.parent.postMessage = (msg, target) => {
  console.log('[IPC OUT]', msg);
  _orig(msg, target);
};
```

### Step 4 — Validate your manifest

```bash
asyar validate
```

Many extension loading failures are manifest validation errors (wrong `id` format, missing `resultType`, etc.).

### Step 5 — Check the dev extension registry

If your extension does not appear in the launcher after scaffolding, check that the dev registry has your path:

```
~/.config/Asyar/dev_extensions.json
```

It should contain an entry mapping your extension ID to the absolute path. If it is missing, run `asyar link` or use the Create Extension tool.

### Common issues and solutions

| Symptom | Cause | Fix |
|---|---|---|
| Extension not appearing in search | Manifest `id` doesn't match directory name | Rename directory to exactly match `id` |
| Extension not appearing in search | Not registered in dev registry | Run `asyar link` |
| Blank white iframe panel | `main.ts` throws before mounting | Open DevTools, check Console for errors |
| `asyar:extension:loaded` never fired | `window.parent.postMessage` call missing from `main.ts` | Add the loaded signal (see template) |
| Service call hangs for 10s then rejects | Missing permission | Declare permission in `manifest.json` |
| External URL fetch blocked | Using `window.fetch()` directly | Use `NetworkService` instead |
| ⌘K shows stale actions from old view | Actions not unregistered in `onDestroy` | Add `actionService.unregisterAction()` cleanup |
| Changes not reflected after save | `pnpm dev` not running | Start `pnpm dev` (Vite watch mode) |
| Double IPC calls | Two `ExtensionContext` instances created | Keep exactly one context in `main.ts` |

---

## 17. Complete Example — Bookmarks Extension

A complete production-ready extension demonstrating:
- A **view command** (open the bookmarks list).
- A **no-view command** (save today's date as a bookmark).
- **In-view search** (filter bookmarks as the user types).
- A **⌘K action** (clear all non-favorite bookmarks).
- **Notification feedback** via `NotificationService`.
- Svelte 5 Runes throughout.

### `manifest.json`

```json
{
  "id": "com.yourname.bookmarks",
  "name": "Bookmarks",
  "version": "1.0.0",
  "description": "Save and search your personal bookmarks quickly.",
  "author": "Your Name",
  "icon": "🔖",
  "main": "dist/index.js",
  "searchable": true,
  "type": "view",
  "defaultView": "BookmarksView",
  "asyarSdk": "^1.3.3",
  "permissions": ["notifications:send"],
  "commands": [
    {
      "id": "open",
      "name": "Open Bookmarks",
      "description": "Browse your saved bookmarks",
      "resultType": "view",
      "view": "BookmarksView"
    },
    {
      "id": "add-today",
      "name": "Bookmark Today's Date",
      "description": "Saves today's date to your bookmarks",
      "resultType": "no-view"
    }
  ]
}
```

### `src/main.ts`

```typescript
import { mount } from 'svelte';
import BookmarksView from './BookmarksView.svelte';
import {
  ExtensionContext,
  type IActionService,
  type INotificationService,
} from 'asyar-sdk';

const extensionId = window.location.hostname || 'com.yourname.bookmarks';

// 1. Single context — one per iframe lifetime.
const context = new ExtensionContext();
context.setExtensionId(extensionId);

// 2. Signal readiness to the host.
window.parent.postMessage({ type: 'asyar:extension:loaded', extensionId }, '*');

// 3. Forward ⌘K to the host.
window.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
    event.preventDefault();
    window.parent.postMessage({
      type: 'asyar:extension:keydown',
      payload: {
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      },
    }, '*');
  }
});

// 4. Resolve services once.
const notifService   = context.getService<INotificationService>('NotificationService');
const actionService  = context.getService<IActionService>('ActionService');

// 5. Handle no-view command (add-today) invoked by the host.
window.addEventListener('message', async (event) => {
  if (event.data?.type !== 'asyar:invoke:command') return;
  const { commandId } = event.data.payload;

  if (commandId === 'add-today') {
    const entry = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    const stored: string[] = JSON.parse(localStorage.getItem('bookmarks') ?? '[]');
    stored.unshift(entry);
    localStorage.setItem('bookmarks', JSON.stringify(stored));
    await notifService.notify({ title: 'Bookmark Added', body: entry });
  }
});

// 6. Mount the view for the correct ?view= param.
const viewName = new URLSearchParams(window.location.search).get('view') || 'BookmarksView';

if (viewName === 'BookmarksView') {
  mount(BookmarksView, {
    target: document.getElementById('app')!,
    props: { actionService, notifService },
  });
}
```

### `src/BookmarksView.svelte`

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ActionContext, ActionCategory } from 'asyar-sdk';
  import type { IActionService, INotificationService } from 'asyar-sdk';

  interface Props {
    actionService: IActionService;
    notifService:  INotificationService;
  }
  let { actionService, notifService }: Props = $props();

  let bookmarks = $state<string[]>([]);
  let query = $state('');

  const filtered = $derived(
    query.trim()
      ? bookmarks.filter(b => b.toLowerCase().includes(query.toLowerCase()))
      : bookmarks
  );

  const ACTION_ID = 'com.yourname.bookmarks:clear-all';

  // --- In-view search listener ---
  function handleMessage(event: MessageEvent) {
    if (event.source !== window.parent) return;
    if (event.data?.type === 'asyar:view:search') {
      query = event.data.payload?.query ?? '';
    }
  }

  onMount(() => {
    // Load from localStorage
    bookmarks = JSON.parse(localStorage.getItem('bookmarks') ?? '[]');

    // Register in-view search listener
    window.addEventListener('message', handleMessage);

    // Register ⌘K action
    actionService.registerAction({
      id: ACTION_ID,
      title: 'Clear Non-Favorites',
      description: 'Remove all bookmarks that are not starred',
      icon: '🗑',
      extensionId: 'com.yourname.bookmarks',
      category: ActionCategory.DESTRUCTIVE,
      context: ActionContext.EXTENSION_VIEW,
      execute: clearNonFavorites,
    });
  });

  onDestroy(() => {
    window.removeEventListener('message', handleMessage);
    actionService.unregisterAction(ACTION_ID); // Critical cleanup
  });

  function addBookmark() {
    const entry = query.trim();
    if (!entry) return;
    bookmarks = [entry, ...bookmarks];
    localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
    query = '';
  }

  function removeBookmark(index: number) {
    bookmarks = bookmarks.filter((_, i) => i !== index);
    localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
  }

  async function clearNonFavorites() {
    bookmarks = [];
    localStorage.removeItem('bookmarks');
    await notifService.notify({
      title: 'Bookmarks Cleared',
      body: 'All bookmarks have been removed.',
    });
  }
</script>

<div class="container">
  <header>
    <h1>🔖 Bookmarks</h1>
    <span class="count">{filtered.length} item{filtered.length !== 1 ? 's' : ''}</span>
  </header>

  {#if filtered.length === 0 && query}
    <p class="empty">No bookmarks match "{query}"</p>
  {:else if bookmarks.length === 0}
    <p class="empty">No bookmarks yet. Type below and press Enter to add one.</p>
  {:else}
    <ul>
      {#each filtered as bookmark, i}
        <li>
          <span>{bookmark}</span>
          <button onclick={() => removeBookmark(i)} aria-label="Delete">✕</button>
        </li>
      {/each}
    </ul>
  {/if}

  <footer>
    <input
      type="text"
      bind:value={query}
      placeholder="Add a bookmark or search..."
      onkeydown={(e) => e.key === 'Enter' && addBookmark()}
    />
  </footer>
</div>

<style>
  .container {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-family: system-ui, sans-serif;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem 0.5rem;
    border-bottom: 1px solid var(--separator);
  }
  h1 { font-size: 1rem; font-weight: 600; margin: 0; }
  .count { font-size: 0.75rem; opacity: 0.5; }
  ul { list-style: none; margin: 0; padding: 0.5rem 0; flex: 1; overflow-y: auto; }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1.25rem;
    border-radius: 6px;
    margin: 0 0.5rem;
  }
  li:hover { background: var(--bg-secondary); }
  li button {
    background: none;
    border: none;
    cursor: pointer;
    opacity: 0.4;
    font-size: 0.75rem;
    color: var(--text-primary);
  }
  li button:hover { opacity: 1; }
  .empty { padding: 2rem 1.25rem; opacity: 0.5; font-size: 0.875rem; }
  footer { padding: 0.75rem 1rem; border-top: 1px solid var(--separator); }
  input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    background: var(--bg-secondary);
    border: 1px solid var(--separator);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 0.875rem;
    outline: none;
    box-sizing: border-box;
  }
  input:focus { border-color: var(--accent-primary); }
</style>
```

---

## 18. Troubleshooting & FAQ

### FAQ

**Q: Can I use React or Vue instead of Svelte?**

Yes. Any framework that builds to static HTML/JS/CSS works. Install the framework, configure Vite accordingly, and bundle everything. The only constraint is that all dependencies must be in `dist/` — there is no shared runtime.

**Q: Can I use `localStorage` for storage?**

Yes, `localStorage` is scoped to the `asyar-extension://` origin within your extension's iframe. Data persists across sessions and is completely isolated from other extensions. Use it freely for local state. Use `SettingsService` when you need data to be accessible to the host or want reactive subscription support.

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

For larger or more complex state, use `localStorage` or `SettingsService`. The entire extension runs in one iframe (the URL changes but the iframe document is reloaded each time `navigateToView` is called), so `localStorage` is the simplest cross-view store.

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
