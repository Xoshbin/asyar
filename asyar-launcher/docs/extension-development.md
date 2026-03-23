# Asyar Extension Development

This document is the official reference for building third-party extensions for Asyar.

## Table of Contents

1. [Introduction](#1-introduction)
2. [Prerequisites](#2-prerequisites)
3. [Your First Extension — Hello World](#3-your-first-extension--hello-world)
4. [The Manifest — Complete Reference](#4-the-manifest--complete-reference)
5. [Commands — The Three Types](#5-commands--the-three-types)
6. [The SDK — Available Services](#6-the-sdk--available-services)
7. [Actions — The ⌘K Panel](#7-actions--the-k-panel)
8. [Permissions Reference](#8-permissions-reference)
9. [Development Workflow](#9-development-workflow)
10. [Publishing to the Asyar Store](#10-publishing-to-the-asyar-store)
11. [Extension Anatomy — End-to-End Example](#11-extension-anatomy--end-to-end-example)
12. [Troubleshooting](#12-troubleshooting)
13. [FAQ](#13-faq)
14. [Real-World Case Study — Tauri Docs Extension](#14-real-world-case-study--tauri-docs-extension)

---

## 1. Introduction

Asyar extensions add commands to the global launcher, contribute live search results as the user types, and open rich UI panels — all without touching Asyar's source code.

### What an extension can do

- Register one or more **commands** that appear in the launcher when the user types a trigger phrase.
- Return **inline search results** directly into the global search bar (like a calculator or currency converter).
- Open a full **view panel** rendered as an iframe — build menus, detail pages, and data-rich UIs.
- Show **system notifications**, read and write the **clipboard**, log structured messages, and register **keyboard-accessible actions** in the ⌘K Action Drawer.

### The sandbox model

Every Installed extension runs inside a sandboxed `<iframe>`. The iframe loads your bundled HTML/JS/CSS through a custom `asyar-extension://` protocol — it is not a web page and has no internet origin. All communication with Asyar (navigating views, firing notifications, reading the clipboard) goes through a `postMessage` bridge that the SDK wraps for you. If your extension calls an API it has not declared a permission for, the host blocks the call and returns a structured error immediately — it never hangs.

The practical consequence: your extension is completely isolated. It cannot crash Asyar, cannot read another extension's storage, and cannot reach the host's DOM. This also means every dependency — including Svelte itself — must be bundled into your `dist/` output.

### What you need to know

- **TypeScript** — the SDK and all examples use TypeScript.
- **Svelte 5** — the recommended UI framework (but any framework that bundles to static HTML/JS/CSS works — React, Vue, vanilla JS are all fine).
- **Vite** — the build tool the CLI expects.
- **A terminal** — the `asyar` CLI drives the entire workflow.

---

## 2. Prerequisites

### Node.js

Node.js 18 or later is required.

### Install the Asyar CLI

```bash
npm install -g asyar-sdk
```

Verify it works:

```bash
asyar --version
```

### Project dependencies

Every extension project needs at minimum:

```bash
pnpm add asyar-sdk svelte
pnpm add -D vite @sveltejs/vite-plugin-svelte typescript
```

The package name for the SDK on npm is `asyar-sdk`. The import path inside your code is also `asyar-sdk`.

---

## 3. Your First Extension — Hello World

This walkthrough builds a working extension from scratch in six steps.

### Step 1 — Scaffold the project

Create a directory whose name matches the extension `id` you intend to use. The directory name **must** match the `id` field in `manifest.json` exactly — Asyar uses the directory name to locate the extension.

```
com.yourname.hello-world/
├── manifest.json
├── package.json
├── vite.config.ts
├── index.html
└── src/
    ├── main.ts
    └── App.svelte
```

> ⚠️ **[AUTHOR NOTE: The `index.html` must be in the project root (next to `manifest.json`), not inside `src/`. The validator checks for `index.html` at the project root.]**

### Step 2 — The manifest

Create `manifest.json`. The comments below are for illustration only — JSON does not support comments; remove them in your actual file.

```json
{
  "id": "com.yourname.hello-world",
  "name": "Hello World",
  "version": "1.0.0",
  "description": "A minimal Asyar extension that says hello.",
  "author": "Your Name",
  "defaultView": "App",
  "commands": [
    {
      "id": "open",
      "name": "Open Hello World",
      "description": "Opens the Hello World view",
      "resultType": "view",
      "view": "App"
    }
  ]
}
```

Every field is explained in the [manifest reference](#4-the-manifest--complete-reference).

### Step 3 — The entry point

`src/main.ts` is the file Vite compiles into your bundle. It bootstraps **one** `ExtensionContext` for the entire extension lifetime, signals readiness to the host, and passes the resolved service instances as **props** to your Svelte component.

> ⚠️ **Create exactly one `ExtensionContext` per iframe.** The constructor attaches `focusin`/`focusout` listeners used for input-focus tracking. Creating a second context (e.g. inside a Svelte component's `onMount`) attaches duplicate listeners, causes double IPC calls, and can break focus detection.

```typescript
// src/main.ts
import { mount } from 'svelte';
import App from './App.svelte';
import {
  ExtensionContext,
  type INetworkService,
  type ILogService,
  type IActionService,
} from 'asyar-sdk';

// The iframe URL is asyar-extension://<extensionId>/index.html?view=<ViewName>.
// We read the extension ID from the hostname.
const extensionId = window.location.hostname || 'com.yourname.hello-world';

// 1. Initialize the single SDK context for this iframe's lifetime.
const context = new ExtensionContext();
context.setExtensionId(extensionId);

// 2. Tell the host we are ready. Without this message the host
//    will not route actions or service calls to this iframe.
window.parent.postMessage(
  { type: 'asyar:extension:loaded', extensionId },
  '*'
);

// 3. Forward ⌘K (and other global shortcuts) to the host so the Action
//    Drawer opens even when focus is inside the iframe.
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

// 4. Pass resolved service instances as props — components receive typed
//    services directly without needing their own context.
const app = mount(App, {
  target: document.getElementById('app')!,
  props: {
    network: context.getService<INetworkService>('NetworkService'),
    logger:  context.getService<ILogService>('LogService'),
    actionService: context.getService<IActionService>('ActionService'),
  },
});

export default app;
```

Your Svelte components declare the services as props:

```svelte
<!-- src/App.svelte -->
<script lang="ts">
  import type { INetworkService, ILogService, IActionService } from 'asyar-sdk';

  interface Props {
    network: INetworkService;
    logger: ILogService;
    actionService: IActionService;
  }
  let { network, logger, actionService }: Props = $props();
</script>
```

### Step 4 — A simple view

```svelte
<!-- src/App.svelte -->
<script lang="ts">
  let count = 0;
</script>

<div style="
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-family: system-ui, sans-serif;
  padding: 2rem;
">
  <h1 style="font-size: 1.5rem; margin-bottom: 1rem;">Hello, World!</h1>
  <p style="opacity: 0.7; margin-bottom: 1.5rem;">Your first Asyar extension is running.</p>
  <button
    onclick={() => count++}
    style="background: #2563eb; color: white; border: none; padding: 0.5rem 1.25rem; border-radius: 6px; cursor: pointer;"
  >
    Clicked {count} times
  </button>
</div>
```

### Step 5 — The `index.html` root file

Vite needs an `index.html` at the project root as its entry point:

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

### Step 6 — The Vite config

```typescript
// vite.config.ts
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
    alias:
      mode === 'development' && existsSync(localSdkEntry)
        ? { 'asyar-sdk': localSdkEntry }
        : undefined,
  },
}));
```

### Step 7 — The package.json

```json
{
  "name": "com.yourname.hello-world",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "asyar dev",
    "build": "asyar build",
    "link": "asyar link"
  },
  "dependencies": {
    "asyar-sdk": "^1.0.0",
    "svelte": "^5.0.0"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^5.0.0",
    "typescript": "^5.0.0",
    "vite": "^6.0.0"
  }
}
```

### Step 8 — Build and link

```bash
# Build the production bundle into dist/
asyar build

# Symlink (or copy) the built extension into Asyar's extensions directory
asyar link
```

`asyar build` runs `vite build` and then verifies that `dist/index.html` was produced. If validation fails, the build aborts with a clear error message.

`asyar link` builds the extension, then creates a symlink at:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/org.asyar.app/extensions/<id>` |
| Windows | `%APPDATA%\org.asyar.app\extensions\<id>` |
| Linux | `~/.local/share/org.asyar.app/extensions/<id>` |

When the symlink is in place, subsequent `vite build` runs are reflected immediately — you do not need to re-run `asyar link`.

### Step 9 — Test it

Open Asyar and type the command name you declared in the manifest ("Open Hello World"). Select it and press Enter. The panel opens and renders your Svelte component.

> 📸 **[SCREENSHOT PLACEHOLDER: Asyar launcher showing the Hello World extension in search results with the command "Open Hello World" highlighted]**

---

## 4. The Manifest — Complete Reference

`manifest.json` lives in the project root (next to `index.html`). Every field is listed below.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | ✅ | Reverse-domain unique identifier. Must match the directory name on disk. Example: `com.yourname.my-extension`. |
| `name` | `string` | ✅ | Human-readable display name shown in the launcher. Must be 2–50 characters. |
| `version` | `string` | ✅ | Semantic version string (e.g. `1.0.0`). Must be valid semver. Used by `asyar publish` for GitHub Release tagging. |
| `description` | `string` | ✅ | Short description shown in the store and launcher. Must be 10–200 characters. |
| `author` | `string` | ✅ | Your name or organization name. |
| `commands` | `array` | ✅ | At least one command definition. See below. |
| `permissions` | `string[]` | ❌ | List of permission strings for SDK services that require them. See [Permissions Reference](#8-permissions-reference). |
| `defaultView` | `string` | ❌ | The default view component name (e.g. `"App"`). Used when a view command does not specify its own `view` field. |
| `type` | `"result" \| "view"` | ❌ | Legacy hint about the extension's primary mode. `resultType` on individual commands is the canonical field. |
| `searchable` | `boolean` | ❌ | When `true`, Asyar forwards global search queries to your extension's `onViewSearch()` method while a view is open. |
| `main` | `string` | ❌ | Path to the compiled JS entry point (e.g. `"dist/index.js"`). Used for headless extensions. |
| `minAppVersion` | `string` | ❌ | Minimum Asyar version required. Not currently enforced by the validator but stored in the manifest for future use. |

### Naming rules for `id`

- Format: `com.author.extensionname` — dot-separated segments, each starting with a lowercase letter, followed by lowercase letters and digits only.
- Regex enforced by the validator: `/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/`
- The directory containing your extension **must be named exactly** the same as this `id`. Asyar discovers extensions by directory name.

### The `commands` array

Each entry in `commands` defines one launcher command:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | ✅ | Unique command ID within the extension (e.g. `"open"`, `"copy-date"`). |
| `name` | `string` | ✅ | Display name shown in the launcher (e.g. `"Open My Extension"`). |
| `description` | `string` | ✅ | Short description of what the command does. |
| `resultType` | `"view" \| "no-view"` | ✅ | What the command produces. `"view"` opens a UI panel; `"no-view"` runs silently. |
| `view` | `string` | ❌ | The Svelte component name to render when `resultType` is `"view"`. Required if `resultType` is `"view"` and no top-level `defaultView` is set. |

### Extension Icons

Add an `icon` field to your manifest to show a branded icon next to your commands in the launcher search results. Supports emoji or a base64 data URI for pixel-perfect images.

**Extension-level icon** (applies to all commands as default):
```json
{
  "id": "com.example.my-extension",
  "icon": "🚀",
  "commands": [...]
}
```

**Command-level icon** (overrides the extension icon for a specific command):
```json
{
  "commands": [
    { "id": "open", "name": "Open My Extension", "icon": "🚀" },
    { "id": "quick-run", "name": "Quick Run", "icon": "⚡" }
  ]
}
```

### The three `resultType` values — how they differ

- **`"view"`** — Asyar opens the extension's iframe panel and renders the component named in the command's `view` field (or `manifest.defaultView`). The URL becomes `asyar-extension://<id>/index.html?view=<ViewName>`.
- **`"no-view"`** — Asyar executes the command silently. No panel opens. Use this for actions like copying text to the clipboard or opening a URL.
- **Inline results (`search()`)** — Not declared as a `resultType`. Instead, implement the `search(query)` method in your extension class and return `ExtensionResult[]`. These results appear live in the global search bar as the user types and do not require a command entry.

### How `permissions` work

Declare every permission your extension needs in the `permissions` array:

```json
{
  "permissions": ["notifications:send", "clipboard:read"]
}
```

If your code calls an SDK method that requires a permission you have not declared, the host blocks the call and returns a structured `{ allowed: false }` error. The extension is not suspended or crashed — the blocked call returns immediately.

---

## 5. Commands — The Three Types

### 5.1 View Commands (`resultType: "view"`)

A view command opens a full-width UI panel rendered as a sandboxed iframe inside Asyar's panel area.

**Manifest entry:**

```json
{
  "id": "open",
  "name": "Open My Extension",
  "description": "Opens the main view",
  "resultType": "view",
  "view": "App"
}
```

**How Asyar renders it:**

When the user selects the command, Asyar loads:
```
asyar-extension://<extensionId>/index.html?view=App
```

Your `src/main.ts` reads `?view=App` from `window.location.search` and mounts the correct Svelte component. The iframe runs under this `sandbox` attribute:

```
allow-scripts allow-same-origin allow-forms allow-popups
```

And this Content Security Policy (set by the Tauri protocol handler):

```
default-src asyar-extension: 'self';
script-src asyar-extension: 'unsafe-inline' 'unsafe-eval';
style-src asyar-extension: 'unsafe-inline';
font-src asyar-extension:;
img-src asyar-extension: data:;
```

This means: scripts may only be loaded from the `asyar-extension:` origin (your bundled files). External CDN script tags will be blocked. External network requests require the `network` permission and must go through the SDK.

**Receiving context when the view opens:**

The view name is the only parameter Asyar passes in the URL. If you need to pass query context (what the user typed), read it from local state your extension set before navigating, or read `window.location.search` for additional `?key=value` pairs.

> 📸 **[SCREENSHOT PLACEHOLDER: A view command open in the Asyar panel showing a Svelte UI component rendered inside the extension iframe]**

### 5.2 No-View Commands (`resultType: "no-view"`)

A no-view command runs and finishes without opening a panel. Use it to copy something to the clipboard, open a URL, trigger a system action, or show a notification.

**Manifest entry:**

```json
{
  "id": "copy-date",
  "name": "Copy Today's Date",
  "description": "Copies the current date to your clipboard",
  "resultType": "no-view"
}
```

**Implementation:**

For Installed extensions, no-view logic lives in the view's JavaScript that runs after the iframe loads. Because Asyar cannot call your TypeScript class directly (Installed extensions run in an iframe, not in the host process), the host opens the iframe briefly, sends a `postMessage` with the command ID, and your `main.ts` can handle it:

```typescript
// src/main.ts — handling a no-view command
window.addEventListener('message', async (event) => {
  if (event.data?.type === 'asyar:invoke:command') {
    const { commandId } = event.data.payload;
    if (commandId === 'copy-date') {
      const date = new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
      });
      await navigator.clipboard.writeText(date);
      // Optionally notify the user via the SDK
      const context = new ExtensionContext();
      context.setExtensionId(extensionId);
      const notif = context.getService<INotificationService>('NotificationService');
      await notif.notify({ title: 'Date Copied', body: date });
    }
  }
});
```

### 5.3 In-View Search (`searchable: true`)

Some extensions (like a Clipboard History or Documentation Browser) don't need to pollute the global search results with inline items. Instead, they want to let the user open the extension view, and *then* use the global Asyar search bar to filter items *inside* that view.

**How In-View Search works:**

1.  In your `manifest.json`, add `"searchable": true` to the root of the file.
2.  When your extension's view is open, the Asyar search bar remains focused, but the placeholder text changes to indicate searching within your extension.
3.  As the user types, the Asyar host sends a `postMessage` to your extension's iframe containing the search query.
4.  Your extension listens for this message and updates its internal state (e.g., filtering a list of Svelte components) in real-time.

**Manifest entry:**

```json
{
  "id": "org.asyar.my-docs",
  "name": "My Docs",
  "version": "1.0.0",
  "type": "view",
  "defaultView": "DefaultView",
  "searchable": true,
  "commands": [
    {
      "id": "open",
      "name": "Open My Docs",
      "resultType": "view"
    }
  ]
}
```

**Implementation in your View (Svelte example):**

Your frontend code runs inside the iframe. It just needs to listen for the `asyar:view:search` message from the parent window.

```html
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  let searchQuery = '';
  let items = ['Apple', 'Banana', 'Cherry', 'Date'];
  
  // Reactively filter items based on the search query
  $: filteredItems = items.filter(i => 
    i.toLowerCase().includes(searchQuery.toLowerCase())
  );

  function handleMessage(event: MessageEvent) {
    if (event.source !== window.parent) return;
    
    // Listen for the specific search message
    if (event.data?.type === 'asyar:view:search') {
      searchQuery = event.data.payload?.query || '';
    }
  }

  onMount(() => {
    window.addEventListener('message', handleMessage);
  });

  onDestroy(() => {
    window.removeEventListener('message', handleMessage);
  });
</script>

<div>
  {#each filteredItems as item}
    <div>{item}</div>
  {/each}
</div>
```

This pattern keeps the global namespace clean while still offering a lightning-fast, native-feeling search experience inside your extension.

> 📸 **[SCREENSHOT PLACEHOLDER: The Tauri Docs extension open, with the global search bar focused, showing filtered documentation results inside the extension view]**

---

## 6. The SDK — Available Services

All services are accessed through `ExtensionContext.getService<T>(serviceName)`. The context is set up in `main.ts` and the extension ID must be set before calling any service.

```typescript
import { ExtensionContext } from 'asyar-sdk';
import type { INotificationService } from 'asyar-sdk';

const context = new ExtensionContext();
context.setExtensionId(extensionId);

const notifications = context.getService<INotificationService>('NotificationService');
await notifications.notify({ title: 'Done', body: 'Task completed' });
```

Every service call goes over `postMessage` to the host. All methods return Promises. There is no synchronous IPC.

---

### 6.1 `LogService` — Structured logging

**Permission required:** None.

**Interface:**

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
log.info('Extension loaded');
log.warn('Falling back to default value');
log.error(new Error('Failed to fetch data'));
log.custom('User clicked button', 'UI', 'cyan', 'MyExtension');
```

Log messages appear in Asyar's developer log panel (accessible from the tray menu). Use `debug` liberally during development, `info` for lifecycle events, and `error` for actionable failures.

---

### 6.2 `NotificationService` — System notifications

**Permission required:** `notifications:send`

**Interface:**

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
```

**Usage:**

```typescript
const notif = context.getService<INotificationService>('NotificationService');

// Check and request permission on first use
const hasPermission = await notif.checkPermission();
if (!hasPermission) {
  await notif.requestPermission();
}

// Send a notification
await notif.notify({
  title: 'Export Complete',
  body: 'Your file has been saved to the Desktop.',
});
```

---

### 6.3 `ClipboardHistoryService` — Clipboard access

**Permission required:** `clipboard:read` for read operations, `clipboard:write` for write operations.

**Interface:**

```typescript
interface IClipboardHistoryService {
  readCurrentClipboard(): Promise<{ type: ClipboardItemType; content: string }>;
  getRecentItems(limit?: number): Promise<ClipboardHistoryItem[]>;
  writeToClipboard(item: ClipboardHistoryItem): Promise<void>;
  pasteItem(item: ClipboardHistoryItem): Promise<void>;
  simulatePaste(): Promise<boolean>;
  toggleItemFavorite(itemId: string): Promise<boolean>;
  deleteItem(itemId: string): Promise<boolean>;
  clearNonFavorites(): Promise<boolean>;
  formatClipboardItem(item: ClipboardHistoryItem): string;
  normalizeImageData(content: string): string;
  isValidImageData(content: string): boolean;
  initialize(): Promise<void>;
  stopMonitoring(): void;
  hideWindow(): Promise<void>;
}

enum ClipboardItemType {
  Text = "text",
  Html = "html",
  Image = "image",
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
const clipboard = context.getService<IClipboardHistoryService>('ClipboardHistoryService');

// Read what's currently on the clipboard
const current = await clipboard.readCurrentClipboard();
console.log(current.type, current.content);

// Get the last 10 clipboard items
const items = await clipboard.getRecentItems(10);

// Write a new text item to the clipboard
await clipboard.writeToClipboard({
  id: crypto.randomUUID(),
  type: ClipboardItemType.Text,
  content: 'Hello from my extension',
  createdAt: Date.now(),
  favorite: false,
});
```

---

### 6.4 `ActionService` — ⌘K action registration

**Permission required:** None.

See [Section 7](#7-actions--the-k-panel) for the full guide. The service interface:

```typescript
interface IActionService {
  registerAction(action: ExtensionAction): void;
  unregisterAction(actionId: string): void;
  getActions(context?: ActionContext): ExtensionAction[];
  executeAction(actionId: string): Promise<void>;
  setContext(context: ActionContext, data?: { commandId?: string }): void;
  getContext(): ActionContext;
}

interface ExtensionAction {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  extensionId: string;
  category?: string;
  context?: ActionContext;
  execute: () => Promise<void> | void;
}

enum ActionContext {
  GLOBAL = "global",
  EXTENSION_VIEW = "extension_view",
  SEARCH_VIEW = "search_view",
  RESULT = "result",
  CORE = "core",
  COMMAND_RESULT = "command_result",
}

const ActionCategory = {
  PRIMARY:     'Primary',
  NAVIGATION:  'Navigation',
  EDIT:        'Edit',
  SHARE:       'Share',
  DESTRUCTIVE: 'Destructive',
  SYSTEM:      'System',
} as const;
```

#### How action execution works (Tier 2 / Installed extensions)

The `execute` function is a live JavaScript closure. It **cannot be serialized over `postMessage`**. The IPC bridge therefore uses a two-registry approach:

1. When you call `registerAction({ id, ..., execute })`, the SDK stores the closure locally in the iframe's `ExtensionBridge.actionRegistry`. Only the metadata (`id`, `title`, `description`, `icon`, `category`, `context`, `extensionId`) is sent to the host.
2. When the user activates the action from the ⌘K Drawer, the host sends an `asyar:action:execute` message to the correct extension iframe.
3. The SDK receives that message and looks up the `execute` closure in `actionRegistry`, then calls it.

This means:
- `registerAction()` must be called **before** the action can be triggered — register during `onMount`, not on first use.
- Pass the **bare** action ID to `unregisterAction()` — do not add any prefix. The SDK matches using the `action.id` you provided to `registerAction()`.

```typescript
// Correct — matches the id used in registerAction
actionService.unregisterAction('com.yourname.my-extension:refresh');

// Wrong — adding a prefix breaks the lookup
actionService.unregisterAction('com.yourname.my-extension:com.yourname.my-extension:refresh');
```

---

### 6.5 `ExtensionManager` — Navigation and extension control

**Permission required:** None.

This is the most commonly used service. It lets your extension navigate between views, go back, and control the panel.

```typescript
interface IExtensionManager {
  navigateToView(viewPath: string): void;
  goBack(): void;
  setActiveViewActionLabel(label: string | null): void;
  setActiveViewStatusMessage(message: string | null): void;
  reloadExtensions(): Promise<void>;
  getAllExtensions(): Promise<any[]>;
  searchAll(query: string): Promise<ExtensionResult[]>;
  // ... additional internal methods
}
```

**Usage:**

```typescript
const manager = context.getService<IExtensionManager>('ExtensionManager');

// Open a view panel
manager.navigateToView('com.yourname.my-extension/DetailView');

// Go back to the search results
manager.goBack();

// Update the label shown in the bottom right action bar
manager.setActiveViewActionLabel('Save');
manager.setActiveViewActionLabel(null); // clear

// Show a temporary sub-status message in the bottom left (useful for async operations)
manager.setActiveViewStatusMessage('⏳ Syncing data...');
manager.setActiveViewStatusMessage(null); // clear
```

The `viewPath` format is `<extensionId>/<ViewComponentName>`. The host translates this into the iframe URL `asyar-extension://<extensionId>/index.html?view=<ViewComponentName>`.

---

### 6.6 `NetworkService` — Outbound HTTP requests

**Permission required:** `network`

**Interface:**

```typescript
interface INetworkService {
  fetch(url: string, options?: RequestOptions): Promise<NetworkResponse>;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  body?: string;
  timeout?: number; // milliseconds, default 20000
}

interface NetworkResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  ok: boolean;
}
```

**Usage:**

```typescript
const network = context.getService<INetworkService>('NetworkService');

// GET request
const response = await network.fetch('https://api.example.com/data');
if (response.ok) {
  const data = JSON.parse(response.body);
}

// POST request with JSON body
const result = await network.fetch('https://api.example.com/items', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'My Item' }),
  timeout: 10000,
});
```

**Why you must use `NetworkService` instead of `fetch()`:**

The iframe's Content Security Policy blocks all external network requests (`default-src asyar-extension: 'self'`). Calling `window.fetch()` or `XMLHttpRequest` to an external URL will fail with a CSP violation. `NetworkService` routes the request through the host process (using a Tauri backend command), which is not subject to the iframe's CSP. Declare `"network"` in your `manifest.json` permissions and use the service for all outbound HTTP calls.

**Timeout behaviour:**

The `timeout` option (default 20 000 ms) controls how long the backend waits for the remote server to respond. The SDK adds an additional IPC timeout on top of this to guarantee that `fetch()` always resolves or rejects — it will never hang indefinitely. If the backend does not respond in `timeout + 15 000 ms`, the SDK rejects the promise with `"IPC Request timed out"`.

---

### 6.7 `StatusBarService` — Live tray menu items

**Permission required:** None.

Tray items allow extensions to register and display live-updating status elements directly in the Asyar macOS menu bar icon dropdown. Use this service to show real-time extension state to the user, such as a running timer, active sync status, or background processing state.

**Interface:**

```typescript
interface IStatusBarItem {
  id: string;       // Unique within your extension
  icon?: string;    // Emoji or short string prepended to text
  text: string;     // The display text, e.g. "18:32" or "Idle"
}

interface IStatusBarService {
  registerItem(item: IStatusBarItem): void;
  updateItem(id: string, updates: Partial<Pick<IStatusBarItem, 'icon' | 'text'>>): void;
  unregisterItem(id: string): void;
}
```

**Usage:**

```typescript
import type { IStatusBarService } from 'asyar-sdk';

const statusBarService = context.getService<IStatusBarService>('StatusBarService');

// Change to focus phase
statusBarService.registerItem({ id: 'timer', icon: '🍅', text: '18:32' });

// On every timer tick
statusBarService.updateItem('timer', { text: '18:31' });

// Change to break phase
statusBarService.updateItem('timer', { icon: '☕', text: '05:00' });

// Done / idle
statusBarService.unregisterItem('timer');
```

**Methods (`IStatusBarService`):**

| Method | Parameters | Description |
|---|---|---|
| `registerItem(item)` | `item: IStatusBarItem` | Registers a new tray menu item. Idempotent: calling again with the same id replaces the existing item. |
| `updateItem(id, updates)` | `id: string, updates: Partial<Pick<IStatusBarItem, 'icon' \| 'text'>>` | Updates an existing item in-place. Safe to call on every timer tick (updates are debounced internally). |
| `unregisterItem(id)` | `id: string` | Removes the item from the tray menu. Call this when your extension state becomes idle. |

**Properties (`IStatusBarItem`):**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | ✅ | Stable identifier for this item. Unique within your extension. |
| `icon` | `string` | ❌ | Emoji or short symbol prepended to text (e.g., '🍅'). |
| `text` | `string` | ✅ | The display string shown in the tray menu (e.g., '18:32', 'Syncing…'). |

Items registered from your extension are automatically cleared when the extension is uninstalled. When a user clicks your tray item, Asyar opens the launcher and navigates to your extension's `defaultView`. Ensure `defaultView` is set in your manifest if you want click-to-navigate to work.

---

## 7. Actions — The ⌘K Panel

Actions are keyboard-accessible commands that appear in Asyar's Action Drawer when the user presses **⌘K**. They are contextual — different actions are available depending on whether a view is open, what command is active, and what your extension registers.

### What actions are for

Use actions for secondary operations that are relevant only while the user is looking at your view — "Refresh", "Export", "Toggle Filter", "Copy All", etc. They complement, rather than replace, the UI controls inside your view.

### Registering an action

Register actions after your view is mounted. Actions are registered by calling `ActionService.registerAction()` on the service proxy:

```typescript
import { ActionContext, ActionCategory, type IActionService, type ExtensionAction } from 'asyar-sdk';

// Inside main.ts or a Svelte component's onMount callback:
const actionService = context.getService<IActionService>('ActionService');

const refreshAction: ExtensionAction = {
  id: 'com.yourname.my-extension:refresh',
  title: 'Refresh',
  description: 'Re-fetch data from the source',
  icon: '↻',
  extensionId: 'com.yourname.my-extension',
  category: ActionCategory.PRIMARY,
  context: ActionContext.EXTENSION_VIEW,
  execute: async () => {
    // Your refresh logic here
    await loadData();
  },
};

actionService.registerAction(refreshAction);
```

> ⚠️ **Make action IDs globally unique.** Use your extension ID as a namespace prefix: `com.yourname.my-extension:action-name`.

### Unregistering actions — critical

**Always unregister actions when the view unmounts.** If you leave actions registered after the view closes, they accumulate and pollute the Action Drawer for unrelated views.

In a Svelte component:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { IActionService } from 'asyar-sdk';

  const ACTION_ID = 'com.yourname.my-extension:refresh';

  onMount(() => {
    actionService.registerAction({ id: ACTION_ID, /* ... */ });
  });

  onDestroy(() => {
    // This runs when the component unmounts (view closes or navigates away)
    actionService.unregisterAction(ACTION_ID);
  });
</script>
```

If the user exits a view while actions are still registered, those actions continue to appear in ⌘K for every subsequent view — including other extensions' views. There is no automatic cleanup.

### Action fields explained

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | ✅ | Globally unique ID. Namespace with your extension ID. |
| `title` | `string` | ✅ | Label shown in the Action Drawer. |
| `extensionId` | `string` | ✅ | Your extension's `id` from `manifest.json`. |
| `description` | `string` | ❌ | Secondary text shown below the title in the drawer. |
| `icon` | `string` | ❌ | Emoji or icon string shown next to the title. |
| `category` | `string \| ActionCategoryValue` | ❌ | Group label for grouping related actions in the drawer. Use `ActionCategory` constants for standard groups. Default: Extension Display Name |
| `context` | `ActionContext` | ❌ | When this action should be visible (`EXTENSION_VIEW`, `GLOBAL`, etc.). |
| `execute` | `() => void \| Promise<void>` | ✅ | Called when the user activates the action. |

### Action contexts

| Context | When shown |
|---|---|
| `ActionContext.GLOBAL` | Always visible |
| `ActionContext.EXTENSION_VIEW` | Only while an extension view is open |
| `ActionContext.SEARCH_VIEW` | While the search results list is active |
| `ActionContext.RESULT` | When a specific result is highlighted |
| `ActionContext.CORE` | Core Asyar actions (do not use) |
| `ActionContext.COMMAND_RESULT` | After a command result has been returned |

### Standard categories (`ActionCategory`)

Use these standard categories for consistent grouping across extensions. Custom strings are also fully supported.

| Constant | Display name | Use for |
|----------|-------------|---------|
| `ActionCategory.PRIMARY` | Primary | Main actions for the extension |
| `ActionCategory.NAVIGATION` | Navigation | Opening views, going back |
| `ActionCategory.EDIT` | Edit | Create, update, delete operations |
| `ActionCategory.SHARE` | Share | Export, copy, send |
| `ActionCategory.DESTRUCTIVE` | Destructive | Irreversible actions (delete, reset) |
| `ActionCategory.SYSTEM` | System | Reserved for built-in host actions |

> 📸 **[SCREENSHOT PLACEHOLDER: The ⌘K action drawer open showing a "Refresh" action registered by a third-party extension, alongside other extension-registered actions]**

---

## 8. Permissions Reference

Declare permissions in `manifest.json` under the `permissions` key:

```json
{
  "permissions": ["notifications:send", "clipboard:read", "clipboard:write"]
}
```

| Permission | What it unlocks | SDK methods that require it |
|---|---|---|
| `clipboard:read` | Read current clipboard and history | `ClipboardHistoryService.readCurrentClipboard()`, `ClipboardHistoryService.getRecentItems()` |
| `clipboard:write` | Write to clipboard, paste, delete items | `ClipboardHistoryService.writeToClipboard()`, `pasteItem()`, `simulatePaste()`, `toggleItemFavorite()`, `deleteItem()`, `clearNonFavorites()` |
| `notifications:send` | Send system notifications | `NotificationService.notify()`, `NotificationService.checkPermission()`, `NotificationService.requestPermission()` |
| `store:read` | Read from the app's key-value store | `StoreService.get()`, `StoreService.list()` (future) |
| `store:write` | Write to the app's key-value store | `StoreService.set()`, `StoreService.delete()` (future) |
| `fs:read` | Read files from the filesystem | `FileService.read()`, `FileService.list()` (future) |
| `fs:write` | Write files to the filesystem | `FileService.write()`, `FileService.delete()` (future) |
| `shell:execute` | Execute shell commands | `ShellService.execute()` (future); also gates raw `asyar:api:invoke` calls |
| `shell:open-url` | Open a URL in the user's default system browser | Send `asyar:api:opener:open` postMessage (see FAQ) |
| `network` | Make outbound HTTP requests | `NetworkService.fetch()` |

### What happens if a permission is missing

When your extension calls a method that requires a permission it has not declared, the host's permission gate intercepts the `postMessage` before it reaches the service implementation. The gate returns a structured error immediately — the Promise rejects with a reason explaining which permission is missing. The extension continues running normally.

```typescript
// This will reject if notifications:send is not in manifest.json permissions[]
try {
  await notif.notify({ title: 'Hello', body: 'World' });
} catch (err) {
  console.error(err);
  // "Extension "com.yourname.ext" called "asyar:api:notification:notify"
  // but did not declare permission "notifications:send" in its manifest.json"
}
```

### Principle of least privilege

Only declare permissions you actually use. Reviewers inspect the permissions list during store review and will question undeclared or unnecessary permissions.

---

## 9. Development Workflow

### 9.1 Local development with `asyar link`

`asyar link` performs two actions in sequence:
1. Runs `vite build` to produce `dist/`.
2. Creates a **symlink** from `<extensions-dir>/<id>` pointing to your project root. On Windows it uses a directory junction. If symlink creation fails (e.g. permissions), it falls back to copying files.

With a symlink in place:
- Subsequent `vite build` runs (or `asyar build`) are immediately reflected — Asyar reads directly from your build output through the symlink.
- You do **not** need to run `asyar link` again after each rebuild.
- You do need to reload or re-trigger the extension in Asyar to see UI changes (the iframe is loaded fresh each time the panel opens, so re-opening the panel is enough).

**`asyar link --watch`** adds a file watcher that automatically rebuilds on every `src/` change:

```bash
asyar link --watch
```

### 9.2 `asyar dev` — full watch mode

`asyar dev` is the recommended workflow for active development:

```bash
asyar dev
```

It:
1. Validates the manifest (prints warnings but continues).
2. Runs an initial `vite build`.
3. Links the extension (symlink if possible, copy fallback).
4. Watches `src/` for changes and runs `vite build` on every save.

Since a symlink is used, every successful rebuild is live in Asyar the next time you open the extension's panel.

> 📸 **[SCREENSHOT PLACEHOLDER: Terminal showing asyar dev watch mode output with "Watching src/ for changes..." and periodic "✓ Rebuilt — changes are live" messages]**

### 9.3 Validating your extension

```bash
asyar validate
```

The validator checks:

| Check | Rule |
|---|---|
| `id` present | Required |
| `id` format | Must match `/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/` |
| `name` present | Required, 2–50 characters |
| `version` present | Required, valid semver |
| `description` present | Required, 10–200 characters |
| `author` present | Required |
| `permissions` values | Each must be a recognized permission string |
| `commands` array | At least one entry required |
| Each command `id` | Required |
| Each command `name` | Required |
| Each command `resultType` | Must be `"view"` or `"no-view"` |
| `view` field when `resultType: "view"` | Required if no top-level `defaultView` |
| `index.html` in project root | Must exist |
| `vite.config.ts` or `vite.config.js` | Must exist |

Output example:
```
✓ manifest.json found and parsed
✓ id: com.yourname.hello-world
✓ name: Hello World
✓ version: 1.0.0
✓ description: A minimal Asyar extension.
✓ author: Your Name

✓ All checks passed
```

### 9.4 Building for release

```bash
asyar build
```

`asyar build`:
1. Validates the manifest. Use `--skip-validate` to bypass.
2. Runs `vite build` using your local `node_modules/.bin/vite`.
3. Verifies `dist/index.html` was produced.
4. Prints a file size report.

**Bundle size considerations:** Every dependency your extension uses — including Svelte, any component library, and utility packages — must be bundled into `dist/`. There is no runtime shared library. The iframe has no access to Asyar's own Svelte runtime. Vite's default configuration handles this correctly; do not mark Svelte as external.

---

## 10. Publishing to the Asyar Store

### The publish pipeline

```bash
asyar publish
```

This is a multi-step pipeline. Each step is idempotent — if a step was already completed in a previous run, the command detects this and resumes from where it left off.

**Step 1 — Validate**

The manifest is validated with the same rules as `asyar validate`. If validation fails, the command exits before touching GitHub or the store.

**Step 2 — Build**

`vite build` runs automatically. The output is verified.

**Step 3 — Authenticate with the Asyar Store**

You are prompted to sign in via GitHub OAuth (device flow). Your browser opens to `github.com/login/device` where you enter a code shown in the terminal. After authorization, a store token is stored locally and reused in future runs.

> 📸 **[SCREENSHOT PLACEHOLDER: Terminal showing asyar publish flow with GitHub device code prompt, the code displayed, and a URL to visit]**

**Step 4 — Resolve the GitHub repository**

The command finds your GitHub repository in this priority order:
1. `--repo <url>` flag (explicit override).
2. `git remote get-url origin` (if the working directory has a git remote).
3. `~/.asyar/config.json` (stored from a previous publish run).
4. Automatically creates a new public GitHub repository named `asyar-<last-segment-of-id>-extension`.

**Step 5 — Check for existing release**

The command checks GitHub for a release with the tag `v<version>`. If the release and its zip asset already exist (previous completed publish), the command skips to Step 8.

**Step 6 — Package**

A zip file is created from `dist/` and `manifest.json`. A SHA-256 checksum is computed.

**Step 7 — Create GitHub Release**

A GitHub Release is created with the tag `v<version>` and the zip is uploaded as a release asset.

**Step 8 — Submit to the Asyar Store**

The store API receives: the repo URL, extension ID, version, release tag, download URL, and checksum.

**Step 9 — Review**

Your extension enters a review queue. When approved, it appears in the Asyar Store.

### Publishing a new version

Bump the version in `manifest.json`:

```json
{ "version": "1.1.0" }
```

Then run `asyar publish` again. The command creates a new GitHub Release with tag `v1.1.0` and submits a new store entry.

### What reviewers check

- Manifest completeness and valid permissions.
- The extension does what the description says.
- No malicious code or unnecessary permission requests.
- The extension builds cleanly from the published source.

---

## 11. Extension Anatomy — End-to-End Example

This section builds a **Bookmarks** extension that demonstrates all major concepts:
- A view command that shows a list of bookmarks.
- An inline result command that searches bookmarks as the user types.
- A ⌘K action that clears all bookmarks.
- A no-view command that adds the current date as a bookmark.
- Notification feedback via the SDK.

### `manifest.json`

```json
{
  "id": "com.yourname.bookmarks",
  "name": "Bookmarks",
  "version": "1.0.0",
  "description": "Save and search your personal bookmarks quickly.",
  "author": "Your Name",
  "defaultView": "BookmarksView",
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
      "name": "Add Today's Date as Bookmark",
      "description": "Saves today's date string to your bookmarks",
      "resultType": "no-view"
    }
  ]
}
```

### `index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Bookmarks</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

### `vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
});
```

### `src/main.ts`

The entry point creates **one** `ExtensionContext` for the entire iframe lifetime and passes resolved service instances as **props** to Svelte components. See [Section 3, Step 3](#step-3--the-entry-point) for the pattern rationale.

```typescript
import { mount } from 'svelte';
import BookmarksView from './BookmarksView.svelte';
import {
  ExtensionContext,
  type IActionService,
  type INotificationService,
} from 'asyar-sdk';

const extensionId = window.location.hostname || 'com.yourname.bookmarks';

// 1. Single context for this iframe's lifetime
const context = new ExtensionContext();
context.setExtensionId(extensionId);

// 2. Signal readiness to the host
window.parent.postMessage({ type: 'asyar:extension:loaded', extensionId }, '*');

// 3. Forward ⌘K to the host so the Action Drawer opens from inside the iframe
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

// 4. Handle no-view command invocations relayed from the host
const notif = context.getService<INotificationService>('NotificationService');
window.addEventListener('message', async (event) => {
  if (event.data?.type === 'asyar:invoke:command') {
    const { commandId } = event.data.payload;
    if (commandId === 'add-today') {
      const entry = new Date().toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
      const stored = JSON.parse(localStorage.getItem('bookmarks') ?? '[]');
      stored.unshift(entry);
      localStorage.setItem('bookmarks', JSON.stringify(stored));
      await notif.notify({ title: 'Bookmark Added', body: entry });
    }
  }
});

// 5. Resolve services once and pass as props — never call getService() inside components
const viewName = new URLSearchParams(window.location.search).get('view') || 'BookmarksView';

if (viewName === 'BookmarksView') {
  mount(BookmarksView, {
    target: document.getElementById('app')!,
    props: {
      actionService: context.getService<IActionService>('ActionService'),
      notifService:  context.getService<INotificationService>('NotificationService'),
    },
  });
}
```

### `src/BookmarksView.svelte`

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { IActionService, INotificationService } from 'asyar-sdk';

  // Svelte 5 props — services injected from main.ts
  interface Props {
    actionService: IActionService;
    notifService: INotificationService;
  }
  let { actionService, notifService }: Props = $props();

  let bookmarks: string[] = $state([]);
  let query = $state('');

  const ACTION_ID = 'com.yourname.bookmarks:clear-all';

  const filtered = $derived(
    query
      ? bookmarks.filter(b => b.toLowerCase().includes(query.toLowerCase()))
      : bookmarks
  );

  function loadBookmarks() {
    bookmarks = JSON.parse(localStorage.getItem('bookmarks') ?? '[]');
  }

  function addBookmark() {
    if (!query.trim()) return;
    bookmarks = [query.trim(), ...bookmarks];
    localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
    query = '';
  }

  onMount(() => {
    loadBookmarks();

    // Register a ⌘K action that is only active while this view is open
    actionService.registerAction({
      id: ACTION_ID,
      title: 'Clear All Bookmarks',
      description: 'Removes every saved bookmark',
      icon: '🗑️',
      extensionId: 'com.yourname.bookmarks',
      category: 'Bookmarks',
      execute: async () => {
        localStorage.removeItem('bookmarks');
        bookmarks = [];
        await notifService.notify({
          title: 'Bookmarks Cleared',
          body: 'All bookmarks have been removed.',
        });
      },
    });
  });

  onDestroy(() => {
    // CRITICAL: always unregister actions on unmount
    actionService.unregisterAction(ACTION_ID);
  });
</script>

<div style="display: flex; flex-direction: column; height: 100%; padding: 1.5rem; font-family: system-ui;">
  <h2 style="margin: 0 0 1rem; font-size: 1.1rem;">Bookmarks</h2>

  <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
    <input
      bind:value={query}
      placeholder="Search or add bookmark..."
      style="flex: 1; padding: 0.5rem 0.75rem; border-radius: 6px; border: 1px solid #444; background: #1e1e1e; color: #fff;"
    />
    <button
      onclick={addBookmark}
      style="padding: 0.5rem 1rem; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer;"
    >
      Add
    </button>
  </div>

  {#if filtered.length === 0}
    <p style="opacity: 0.5; text-align: center; margin-top: 2rem;">No bookmarks yet.</p>
  {:else}
    <ul style="list-style: none; margin: 0; padding: 0; overflow-y: auto;">
      {#each filtered as bookmark}
        <li style="padding: 0.75rem; border-bottom: 1px solid #2a2a2a; cursor: default;">
          {bookmark}
        </li>
      {/each}
    </ul>
  {/if}
</div>
```

### `src/index.ts` — inline search support

```typescript
import type { Extension, ExtensionContext, ExtensionResult } from 'asyar-sdk';

class BookmarksExtension implements Extension {
  private extensionManager?: any;
  onUnload = () => {};

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService('ExtensionManager');
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async viewActivated(viewId: string): Promise<void> {}
  async viewDeactivated(viewId: string): Promise<void> {}
  async executeCommand(commandId: string): Promise<any> {}

  async search(query: string): Promise<ExtensionResult[]> {
    if (query.length < 2) return [];

    // Read bookmarks from localStorage (available in the extension context)
    const bookmarks: string[] = JSON.parse(localStorage.getItem('bookmarks') ?? '[]');
    const q = query.toLowerCase();

    const matches = bookmarks
      .filter(b => b.toLowerCase().includes(q))
      .slice(0, 5);

    return matches.map((bookmark, i) => ({
      title: bookmark,
      subtitle: 'Bookmark',
      type: 'result' as const,
      score: 1 - i * 0.1,
      icon: '🔖',
      action: async () => {
        await navigator.clipboard.writeText(bookmark);
        this.extensionManager?.goBack();
      },
    }));
  }
}

export default new BookmarksExtension();
```

> 📸 **[SCREENSHOT PLACEHOLDER: The Bookmarks extension view open showing a list of saved bookmarks with the search input, Add button, and the ⌘K action drawer open showing "Clear All Bookmarks"]**

---

## 12. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Extension doesn't appear in launcher | Directory name doesn't match `id` in manifest | Rename the extension directory to exactly match `manifest.json`'s `id` field |
| Extension appears but panel is blank white | `dist/index.html` not produced, or build was never run | Run `asyar build` and verify `dist/index.html` exists |
| API call silently fails or returns permission error | Permission not declared in `manifest.json` | Add the required permission string to `"permissions": []` in the manifest and re-link |
| Changes not reflected after editing | Symlink not set up, or `asyar dev` not running | Run `asyar dev` (or `asyar link` then `asyar build` on each change) |
| Iframe loads but shows JS error: "Service X not registered" | `context.setExtensionId()` called after `getService()` | Ensure `context.setExtensionId(extensionId)` is called immediately after `new ExtensionContext()`, before any `getService()` call |
| `asyar validate` fails: `commands[0].resultType: must be "view" or "no-view"` | Old manifest using `"mode"` instead of `"resultType"` | Rename the field to `resultType` in manifest commands |
| `asyar publish` fails partway through | Network error or GitHub API error | Re-run `asyar publish` — each step is idempotent and will resume from where it stopped |
| `asyar publish` says "Already submitted and pending review" | The exact version was already submitted | Wait for review, or bump the version in `manifest.json` |
| `asyar publish` says "This version is already approved" | Trying to re-publish an approved version | Bump the version in `manifest.json` to publish an update |
| Actions persist after view closes | `actionService.unregisterAction()` not called in `onDestroy` | Call `unregisterAction(id)` for every registered action inside `onDestroy` |
| ⌘K opens the drawer but the action does nothing | `registerAction()` called after the action was triggered, or `execute` was not registered | Ensure `registerAction()` is called during `onMount`. The `execute` closure is stored locally in the iframe — if the view was not mounted yet, the registry is empty and the action silently no-ops |
| Action `unregisterAction` doesn't remove the action | ID passed to `unregisterAction` has an extra prefix | Pass the bare `action.id` string — the same value you used in `registerAction`. Do not prefix it with the extension ID again |
| Network request times out after 20 seconds | Using `window.fetch()` or the iframe's native fetch | Native fetch is blocked by CSP. Use `NetworkService.fetch()` with the `network` permission in `manifest.json` |
| Network request hangs for 20+ seconds then times out | IPv6 stall in Tauri's HTTP backend on macOS | This is handled by the host's custom `fetch_url` backend command — if you are seeing this, ensure you are routing requests through `NetworkService` (SDK), not directly through `@tauri-apps/plugin-http` |
| `window.open(url)` does nothing or opens a blank Tauri window | WKWebView intercepts `window.open()` inside the sandboxed iframe | To open a URL in the system browser, send `asyar:api:opener:open` via postMessage and declare `shell:open-url` permission. See the FAQ below |
| `asyar build` fails: `"shell:open-url" is not a valid permission` | Old version of `asyar-sdk` CLI that does not recognise this permission | Update `asyar-sdk` to the latest version: `npm install -g asyar-sdk@latest` |
| Arrow keys / Enter do nothing when my view is focused | Host is not forwarding keys into the iframe | The host forwards `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Enter`, and `Tab` to the active extension via `asyar:view:keydown`. Listen for that message in your view to handle keyboard navigation |
| ⌘K does not open the Action Drawer when focus is inside my view | The iframe captures the keydown and does not forward it to the host | Forward ⌘K from inside the iframe via `asyar:extension:keydown` postMessage. See Step 3 of the entry point pattern |
| `asyar link` uses file copy mode instead of symlink | Filesystem permissions or Windows without admin | This is safe — use `asyar build` after every change and the copy will be updated; or run the CLI with elevated permissions to restore symlink mode |
| Search results from extension not appearing | Missing manifest entry or missing bootstrap call | Ensure manifest has a command with `resultType: "result"` and that `context.bootstrap(instance)` is called in `main.ts` |

> 📸 **[SCREENSHOT PLACEHOLDER: Terminal showing asyar validate output with green checkmarks for each passing field and a "✓ All checks passed" summary]**

---

## 13. FAQ

**Q: Can my extension access the filesystem directly?**

No. The iframe sandbox does not grant filesystem access. All filesystem operations must go through the `FileService` SDK service (declared with `fs:read` / `fs:write` permissions), which proxies requests to the host over `postMessage`. The host enforces the permission gate and restricts paths to safe locations.

**Q: Can I use React instead of Svelte?**

Yes. Any framework that produces a static `index.html` + bundled JS/CSS works — React, Vue, Solid, Angular, or vanilla JavaScript. The iframe does not care what framework rendered the HTML. As long as `vite build` produces `dist/index.html`, Asyar can serve it. Update your `vite.config.ts` to use the framework's Vite plugin instead of `@sveltejs/vite-plugin-svelte`.

**Q: Can I import npm packages?**

Yes, with one rule: all packages must be bundled. You cannot use a CDN import (`<script src="https://...">`) because the Content Security Policy blocks external script sources. Install packages via `pnpm add`, import them in your TypeScript source, and Vite will bundle them into `dist/assets/`. This is the default Vite behavior — no extra configuration is needed.

**Q: Why do I have to bundle Svelte itself?**

Because your extension runs in a sandboxed iframe that has no access to the host application's runtime. Even though Asyar itself uses Svelte, the iframe is a completely separate JavaScript environment. Every library your extension needs must ship inside its own `dist/` bundle. Vite handles this automatically when you `import` packages normally.

**Q: Can my extension make HTTP requests to external servers?**

External fetch calls from inside the iframe are blocked by the Content Security Policy (`default-src asyar-extension: 'self'`). To make outbound HTTP requests, declare the `network` permission and use `NetworkService.fetch()` — see [Section 6.6](#66-networkservice--outbound-http-requests). The service routes requests through the host process, which is not subject to the iframe's CSP. Do not use `window.fetch()` or `XMLHttpRequest` directly — they will fail with CSP violations.

**Q: Can my extension store persistent data?**

Within the iframe you have access to `localStorage` and `sessionStorage` — these are scoped to the `asyar-extension://<id>` origin, so each extension has its own isolated storage. For application-managed key-value storage (backed by Tauri's store plugin), use `StoreService` with `store:read` / `store:write` permissions when that service becomes available.

**Q: Can my extension open external URLs in the system browser?**

`window.open()` is intercepted by the WKWebView sandbox inside Asyar and does not open the user's default browser. To open a URL in the system browser, send a `postMessage` to the host requesting the opener service:

1. Declare `"shell:open-url"` in your `manifest.json` permissions array.
2. Send the following message from inside your extension iframe:

```typescript
function openInBrowser(url: string) {
  window.parent.postMessage({
    type: 'asyar:api:opener:open',
    payload: { url },
    messageId: Math.random().toString(36).slice(2),
    extensionId: 'com.yourname.my-extension', // your extension's id
  }, '*');
}
```

The host verifies the `shell:open-url` permission and calls the system opener (`tauri-plugin-opener`), which launches the URL in the user's default browser. Without the permission declared, the call is blocked and silently discarded.

**Q: How do I pass data from the launcher (command arguments) into my view?**

The `view` URL includes a `?view=<ViewName>` parameter. At present, there is no built-in mechanism for passing arbitrary command arguments into the URL. The recommended pattern is to store state in `localStorage` from a no-view command, then read it when the view mounts, or to use the `search` method to pass query context.

> ⚠️ **[AUTHOR NOTE: Confirm whether the host sends a `postMessage` with command args after the iframe loads, and document that pattern here if confirmed.]**

**Q: My extension registered an action but ⌘K doesn't show it — why?**

The `execute` function on `ExtensionAction` is not serialized over IPC — only the action metadata (`id`, `title`, `description`, `icon`, `category`, `context`) is sent to the host. The host stores the metadata and renders it in the drawer. When the user activates the action, the host sends a `postMessage` back to the iframe, and the SDK's `ActionServiceProxy` calls the locally registered `execute` function. This means `execute` must be registered before the action can be triggered. Ensure `registerAction()` is called during `onMount` and not lazily.

**Q: Can I have multiple views in one extension?**

Yes. Add multiple Svelte component files in `src/`. In `main.ts`, resolve `viewName` from `window.location.search` and conditionally mount the correct component. Use `extensionManager.navigateToView('com.yourname.my-ext/DetailView')` from within any view to navigate to another.

**Q: How do I handle keyboard navigation (arrow keys, Enter) inside my view?**

The host forwards `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Enter`, and `Tab` to the active extension iframe when a view is open. Listen for the `asyar:view:keydown` message:

```typescript
window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  if (event.data?.type === 'asyar:view:keydown') {
    const { key, shiftKey, ctrlKey, metaKey, altKey } = event.data.payload;
    // Handle the key in your view's navigation logic
    if (key === 'ArrowDown') selectNextItem();
    if (key === 'ArrowUp') selectPrevItem();
    if (key === 'Enter') activateSelectedItem();
  }
});
```

**Q: How do I make ⌘K open the Action Drawer when focus is inside my view?**

The iframe captures keyboard events before the host sees them. Forward ⌘K (and any other global shortcuts) to the host via `asyar:extension:keydown`. The recommended place is `main.ts`, applied once for the entire iframe:

```typescript
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
```

The host synthesizes a real `KeyboardEvent` on its own `window`, which triggers the ⌘K handler as if the user pressed it outside the iframe.

**Q: How do I prevent Asyar from intercepting Backspace or Escape when users type in my view's form fields?**

Because extensions run in sandboxed iframes, the host application cannot read your DOM to know when an `<input>` or `<textarea>` is focused. By default, Asyar listens for global keyboard shortcuts like `Backspace` (to go back) or `Escape` (to close the launcher). 

To prevent Asyar from triggering navigation shortcuts while a user is typing inside your extension, you must signal your focus state to the host via `postMessage`.

When an input field receives focus (e.g., in a `focus` event listener), send:
```javascript
window.parent.postMessage({ type: 'asyar:extension:input-focus', focused: true }, '*');
```

When the input field loses focus (e.g., in a `blur` event listener), send:
```javascript
window.parent.postMessage({ type: 'asyar:extension:input-focus', focused: false }, '*');
```

When the host receives `{ focused: true }`, it temporarily suspends global navigation shortcuts so your form fields receive Backspace and Escape characters natively without closing the view.

---

**Q: How do I close the Asyar launcher from within an extension?**

If your extension executes a background task (such as a "no-view" command) or performs an action where the launcher should no longer be visible, you can tell the host application to hide the window by sending the `asyar:window:hide` IPC message:

```javascript
window.parent.postMessage({ type: 'asyar:window:hide', extensionId: 'your-extension-id' }, '*');
```

This is particularly useful for timers, clipboard utilities, or system integrations where leaving the Asyar window open would be disruptive to the user's flow.

---

## 14. Real-World Case Study — Tauri Docs Extension

This section walks through the **Tauri Docs** extension (`org.asyar.tauri-docs`) — a production-quality documentation browser that demonstrates the most important Asyar extension patterns in a single project. Study this extension closely; it covers nearly every feature the SDK offers and was battle-tested through several rounds of real debugging.

### What the extension does

Tauri Docs is a split-view panel that lets you search and browse the [Tauri v2 documentation](https://v2.tauri.app) directly from inside Asyar:

- **Left panel** — A grouped, filterable list of documentation entries organised by section (Getting Started, Core Concepts, Plugins, etc.).
- **Right panel** — The selected document's content fetched from `v2.tauri.app`, parsed, cleaned, and rendered inline with styled prose.
- **In-view search** — The host's global search bar filters the doc list in real time.
- **Keyboard navigation** — Arrow keys move through the list; Enter confirms.
- **⌘K action** — "Open in Browser" opens the current doc page in the user's default browser.
- **Loading skeleton** — An animated placeholder shows while content is being fetched.

### 14.1 Project structure

```
org.asyar.tauri-docs/
├── manifest.json
├── package.json
├── vite.config.ts
├── index.html
└── src/
    ├── main.ts                 ← Entry point (single ExtensionContext)
    ├── DefaultView.svelte      ← The full UI component
    └── lib/
        └── docsClient.ts       ← Network fetch + HTML parse + cache
```

### 14.2 The manifest

```json
{
  "id": "org.asyar.tauri-docs",
  "name": "Tauri Docs",
  "version": "1.0.0",
  "description": "Search and browse Tauri v2 documentation",
  "author": "Developer",
  "searchable": true,
  "defaultView": "DefaultView",
  "permissions": ["network", "shell:open-url"],
  "commands": [
    {
      "id": "open",
      "name": "Open Tauri Docs",
      "description": "Browse Tauri v2 documentation",
      "resultType": "view"
    }
  ]
}
```

Key points:

- **`searchable: true`** — Enables in-view search. When the extension's view is open, every keystroke in the host search bar is forwarded to the iframe as `asyar:view:search`.
- **`permissions: ["network", "shell:open-url"]`** — `network` is required for `NetworkService.fetch()` to call `v2.tauri.app`. `shell:open-url` is required to open docs in the system browser via the opener IPC.
- **Only one command** — A single `"view"` command opens the panel. The extension's value comes from the rich in-view experience, not from multiple launcher commands.

### 14.3 The entry point — `src/main.ts`

This file is the most important file to get right. Three critical patterns are established here.

```typescript
import { mount } from 'svelte';
import DefaultView from './DefaultView.svelte';
import {
  ExtensionContext,
  type INetworkService,
  type ILogService,
  type IActionService,
} from 'asyar-sdk';

const extensionId = window.location.hostname || 'org.asyar.tauri-docs';

// ── Pattern 1: Single ExtensionContext ──────────────────────────
// Create exactly ONE context and resolve services HERE, not in components.
const context = new ExtensionContext();
context.setExtensionId(extensionId);

// Tell the host we are loaded. Without this message the host will
// not route IPC traffic to this iframe.
window.parent.postMessage(
  { type: 'asyar:extension:loaded', extensionId },
  '*'
);

// ── Pattern 2: Forward ⌘K to the host ──────────────────────────
// The iframe captures all keyboard events. Global shortcuts like ⌘K
// never reach the host unless we forward them explicitly.
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

// ── Pattern 3: Services as props ────────────────────────────────
// Resolve every service once and inject them into the Svelte component
// as typed $props(). The component never touches ExtensionContext.
const app = mount(DefaultView, {
  target: document.getElementById('app')!,
  props: {
    network: context.getService<INetworkService>('NetworkService'),
    logger: context.getService<ILogService>('LogService'),
    actionService: context.getService<IActionService>('ActionService'),
  },
});

export default app;
```

#### Why this matters — mistakes to avoid

| Mistake | What happens | Fix |
|---|---|---|
| Creating `new ExtensionContext()` inside a Svelte component | Duplicate `focusin`/`focusout` listeners, double IPC calls, broken focus lock | Create the context in `main.ts` only; pass services as props |
| Calling `getService()` inside every component | Each call returns a fresh proxy that attaches new IPC listeners | Call `getService()` once in `main.ts`; pass the returned object down |
| Forgetting `asyar:extension:loaded` | The host never learns the iframe is ready — all IPC silently fails | Always send this message immediately after creating the context |
| Forgetting the ⌘K forwarder | ⌘K is captured by the iframe and never reaches the host | Add the `keydown` listener in `main.ts` |

### 14.4 The view component — `DefaultView.svelte`

This component demonstrates in-view search, keyboard navigation, action registration with cleanup, network-fetched content rendering, and loading states.

#### Receiving services as Svelte 5 props

```svelte
<script lang="ts">
  import type {
    INetworkService, ILogService, IActionService,
  } from 'asyar-sdk';

  interface Props {
    network: INetworkService;
    logger: ILogService;
    actionService: IActionService;
  }
  let { network, logger, actionService: actionServiceProp }: Props = $props();
</script>
```

Services arrive as typed props. The component never imports or creates `ExtensionContext`.

#### State management with Svelte 5 runes

```typescript
let searchQuery = $state('');
let allDocs: DocEntry[] = $state([]);
let filteredDocs: DocEntry[] = $state([]);
let selectedIndex = $state(0);
let isLoadingDoc = $state(false);
let docHtml: string | null = $state(null);
let docError = $state(false);

// Derived state — the currently selected doc entry
let selectedDoc: DocEntry | null = $derived(filteredDocs[selectedIndex] ?? null);
```

Use `$state` for mutable values and `$derived` for computed values. Do not use the legacy Svelte 4 `$:` reactive statement syntax — it still compiles but mixes paradigms confusingly.

#### In-view search — listening for `asyar:view:search`

Because the manifest declares `searchable: true`, the host forwards every search bar keystroke:

```typescript
function handleMessage(event: MessageEvent) {
  if (event.source !== window.parent) return;
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'asyar:view:search') {
    searchQuery = data.payload?.query || '';
    filterDocs();
  }

  if (data.type === 'asyar:view:keydown') {
    const { key } = data.payload;
    if (key === 'ArrowDown') {
      selectedIndex = Math.min(selectedIndex + 1, filteredDocs.length - 1);
      ensureVisible();
    } else if (key === 'ArrowUp') {
      selectedIndex = Math.max(selectedIndex - 1, 0);
      ensureVisible();
    } else if (key === 'Enter') {
      selectItem(selectedIndex);
    }
  }
}

onMount(() => {
  window.addEventListener('message', handleMessage);
  // ...
});

onDestroy(() => {
  window.removeEventListener('message', handleMessage);
});
```

Two message types are handled in a single listener:

1. **`asyar:view:search`** — Updates the search query and re-filters the doc list.
2. **`asyar:view:keydown`** — The host forwards arrow keys and Enter. The component moves the selection index and scrolls the item into view.

> **Do NOT call `listContainer.focus()`** in `onMount` or an `$effect`. DOM focus must remain in the host's search input. If you steal focus into the iframe, the user loses the ability to type in the search bar. Keyboard navigation arrives through `postMessage`, not through native DOM keyboard events.

#### Keyboard scroll-into-view

```typescript
function ensureVisible() {
  requestAnimationFrame(() => {
    const el = listContainer?.querySelector(`[data-index="${selectedIndex}"]`);
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  });
}
```

Use `requestAnimationFrame` so the DOM has updated before querying by `data-index`. Use `block: 'nearest'` to avoid unnecessary scrolling when the item is already visible.

#### Registering a dynamic ⌘K action with `$effect` cleanup

The "Open in Browser" action updates its description and closure every time the user selects a different doc:

```typescript
$effect(() => {
  if (!selectedDoc) return;

  const currentDoc = selectedDoc; // capture for the closure

  const action: ExtensionAction = {
    id: 'open-in-browser',
    title: 'Open in Browser',
    description: `Open ${currentDoc.title} in browser`,
    extensionId: 'org.asyar.tauri-docs',
    context: ActionContext.EXTENSION_VIEW,
    execute: () => openInBrowser(currentDoc.path),
  };

  actionServiceProp.registerAction(action);

  // $effect cleanup — runs before the next effect run AND on component destroy
  return () => {
    actionServiceProp.unregisterAction('open-in-browser');
  };
});
```

Key details:

- **`$effect` returns a cleanup function** — Svelte 5 calls it when the effect re-runs (selectedDoc changes) and when the component is destroyed. This guarantees the action is always properly unregistered.
- **Capture `selectedDoc` into `currentDoc`** — The closure passed to `execute` must capture the value at effect-run time. If you reference `selectedDoc` directly, it will read the latest value at invocation time (after the user may have moved away).
- **The action ID (`'open-in-browser'`) is bare** — No extension prefix. `registerAction` stores by the `id` field as-is. `unregisterAction` must match that exact string. A previous bug in the SDK double-prefixed with the extension ID, causing `unregisterAction` to silently fail and leaving stale actions in the ⌘K drawer.
- **Also unregister in `onDestroy`** as a safety net, in case the `$effect` cleanup doesn't fire on unmount in all edge cases.

#### Opening URLs in the system browser

`window.open()` does not work reliably in Tauri's WKWebView — it either opens a new Tauri window or does nothing. The extension routes through the host's opener plugin:

```typescript
function openInBrowser(path: string) {
  const url = `https://v2.tauri.app${path}`;
  window.parent.postMessage({
    type: 'asyar:api:opener:open',
    payload: { url },
    messageId: Math.random().toString(36).slice(2),
    extensionId: 'org.asyar.tauri-docs',
  }, '*');
}
```

This requires `"shell:open-url"` in the manifest's permissions array. The host checks the permission gate and calls `tauri-plugin-opener` to open the URL in the default browser.

#### Loading states — skeleton UI

While fetching doc content, the right panel shows a skeleton loader instead of a spinner:

```svelte
{:else if isLoadingDoc}
  <div class="detail-loading-view">
    <div class="loading-header">
      <h2>{selectedDoc.title}</h2>
      <span class="loading-subtitle">{selectedDoc.path}</span>
    </div>
    <div class="loading-progress">
      <div class="loading-bar"></div>
    </div>
    <div class="loading-skeleton">
      <div class="skeleton-line" style="width: 90%"></div>
      <div class="skeleton-line" style="width: 75%"></div>
      <div class="skeleton-line" style="width: 60%"></div>
      <div class="skeleton-line short" style="width: 40%"></div>
      <div class="skeleton-block"></div>
      <div class="skeleton-line" style="width: 85%"></div>
      <div class="skeleton-line" style="width: 70%"></div>
    </div>
  </div>
```

The skeleton shows the title and path immediately (from local state), so the user has context about *what* is loading. The animated progress bar and pulsing lines signal activity. This is much better UX than a full-screen spinner.

### 14.5 The network client — `src/lib/docsClient.ts`

This module fetches documentation HTML from `v2.tauri.app`, parses out the main content, cleans it, and caches results.

```typescript
import type { INetworkService } from 'asyar-sdk';

const contentCache = new Map<string, { html: string; timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export async function fetchDocContent(
  url: string,
  network: INetworkService,
  logger?: any
): Promise<string | null> {
  // Return cached result if fresh
  const cached = contentCache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.html;
  }

  try {
    const response = await network.fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'text/html' },
      timeout: 20000,
    });

    if (!response.ok) {
      logger?.error(`fetchDocContent: ${response.status} for ${url}`);
      return null;
    }

    const cleaned = parseDocHtml(response.body);
    if (!cleaned) {
      // Do NOT cache empty results — let the next selection retry
      logger?.warn(`parseDocHtml returned empty for ${url}`);
      return null;
    }
    contentCache.set(url, { html: cleaned, timestamp: Date.now() });
    return cleaned;
  } catch (err: any) {
    logger?.error(`fetchDocContent error: ${err?.message || err}`);
    return null;
  }
}
```

#### Lessons learned from debugging this module

1. **Use `NetworkService.fetch()`, not `window.fetch()`** — The iframe's CSP blocks all external HTTP requests. This is the most common first mistake when building a network-dependent extension.

2. **Set a generous timeout** — The SDK adds 15 seconds of IPC overhead on top of your `timeout` value. With `timeout: 20000`, the total deadline before the SDK rejects is 35 seconds. In practice, the request completes in under 2 seconds — the large buffer is insurance against slow connections.

3. **Never cache empty or failed results** — An earlier version cached `null` results, which meant a transient network failure permanently broke that page until the cache expired. Always check the parsed result is non-empty before caching.

4. **The `network` parameter is the service proxy, not a global** — It is injected from `main.ts`. This makes the function testable and avoids hidden coupling to the SDK singleton.

#### HTML parsing — `parseDocHtml()`

The Tauri docs site uses Starlight (an Astro-based documentation framework). The parser extracts the article content and removes navigation, headers, footers, and scripts:

```typescript
function parseDocHtml(rawHtml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');

  // Select main content BEFORE removing noise — removal can destroy
  // the container if a selector matches both a noise element and the content.
  const selectors = [
    'article.sl-content-body',   // Starlight v2 article wrapper
    'main .content',
    '[data-pagefind-body]',
    'main',
    '.content',
  ];

  let main: Element | null = null;
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el && el.innerHTML.length > 100) {
      main = el;
      break; // Stop at first match — do NOT continue overwriting
    }
  }

  if (!main) main = doc.body;

  // Remove noise from WITHIN the selected content only
  main.querySelectorAll('nav, header, footer, aside, script, style, [data-pagefind-ignore]')
    .forEach(el => el.remove());

  // Fix relative URLs
  main.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (href?.startsWith('/')) {
      a.setAttribute('href', `https://v2.tauri.app${href}`);
    }
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });

  main.querySelectorAll('img[src]').forEach(img => {
    const src = img.getAttribute('src');
    if (src?.startsWith('/')) {
      img.setAttribute('src', `https://v2.tauri.app${src}`);
    }
  });

  return main.innerHTML;
}
```

#### Why the order matters — a bug that took multiple iterations to fix

An earlier version removed noise elements (`nav`, `header`, `footer`, etc.) from the entire document *before* selecting the content container. This caused a subtle bug: on some pages, Starlight wraps the article inside a `<main>` that is a sibling of the `<header>`. Removing `<header>` first was harmless. But on other pages, a matching selector was itself *inside* a `<nav>` or `<aside>`, and removing those first destroyed the content before we could find it.

The fix: **always select the content container first**, then remove noise only from *within* that container.

Another subtle mistake: the selector loop originally did not `break` on the first match. If `article.sl-content-body` matched a short element (< 100 chars, perhaps a table of contents), the loop continued and overwrote `main` with a worse match like `doc.body`. Adding `break` and the `innerHTML.length > 100` guard fixed this.

### 14.6 Summary of patterns demonstrated

| Pattern | Where | Why it matters |
|---|---|---|
| Single `ExtensionContext` | `main.ts` | Prevents duplicate IPC listeners and broken focus tracking |
| Services as Svelte 5 `$props()` | `main.ts` → `DefaultView.svelte` | Components are decoupled from the SDK; services are resolved once |
| `asyar:extension:loaded` readiness signal | `main.ts` | Host will not route IPC to the iframe without this |
| ⌘K forwarding (`asyar:extension:keydown`) | `main.ts` | Global shortcuts are captured by the iframe; must be forwarded |
| In-view search (`asyar:view:search`) | `DefaultView.svelte` | Host forwards search bar keystrokes to the active extension |
| Keyboard navigation (`asyar:view:keydown`) | `DefaultView.svelte` | Arrow keys and Enter are forwarded by the host |
| `$effect` with cleanup for actions | `DefaultView.svelte` | Re-registers the action when the selected doc changes; cleans up on destroy |
| Bare action IDs in `unregisterAction` | `DefaultView.svelte` | Avoids the double-prefix bug that left stale actions in the ⌘K drawer |
| `shell:open-url` via `asyar:api:opener:open` | `DefaultView.svelte` | `window.open()` doesn't work in Tauri's WKWebView |
| `NetworkService.fetch()` with timeout | `docsClient.ts` | `window.fetch()` is blocked by CSP; SDK routes through the host backend |
| Don't cache empty results | `docsClient.ts` | Transient failures become permanent if `null` is cached |
| Select content before removing noise | `docsClient.ts` | Removing elements first can destroy the content container |
| Fix relative URLs in parsed HTML | `docsClient.ts` | Images and links break without absolute URLs |
| Skeleton loading UI | `DefaultView.svelte` | Shows context (title, path) immediately; far better UX than a spinner |
| No `listContainer.focus()` | `DefaultView.svelte` | Stealing DOM focus breaks the host's search input |
| Dark mode via `prefers-color-scheme` | `DefaultView.svelte` | Uses CSS `@media` query — no JS toggling needed |

### 14.7 Common mistakes this extension exposed

These bugs were discovered during real development and testing. Each one silently broke a feature without any error in the console.

**1. `window.open()` does nothing in Tauri**

Tauri's WKWebView intercepts `window.open()` calls. Inside a sandboxed iframe, the call either silently fails or creates a new (invisible) Tauri window. The fix is to route through the host's opener plugin via `asyar:api:opener:open` postMessage. You must also declare `"shell:open-url"` in the manifest — without it, the host's permission gate blocks the call.

**2. Network requests hang for 20+ seconds**

This was a two-layer problem:

- **Layer 1 (iframe):** `window.fetch()` is blocked by CSP. Using `NetworkService.fetch()` fixes this.
- **Layer 2 (host backend):** On macOS, Tauri's HTTP plugin (`@tauri-apps/plugin-http`) uses `reqwest`, which tries IPv6 first. If the server supports both IPv4 and IPv6, the IPv6 connection attempt can stall for 20+ seconds before falling back to IPv4 (a "Happy Eyeballs" failure). The host works around this with a custom Rust command that forces IPv4 via `reqwest::Client::builder().local_address(IpAddr::V4(Ipv4Addr::UNSPECIFIED))`.

As an extension author, you don't need to worry about Layer 2 — the SDK's `NetworkService` routes through the fixed backend automatically. But be aware that network requests go through multiple layers, and set generous timeouts.

**3. Action closures cannot cross the IPC boundary**

The `execute` function on `ExtensionAction` is a JavaScript closure. When `registerAction()` is called, only the metadata (`id`, `title`, `description`, `icon`, etc.) is serialized and sent to the host — `execute` is stripped. The closure stays in the iframe's `ExtensionBridge.actionRegistry`. When the user picks the action from ⌘K, the host sends `asyar:action:execute` back to the iframe, and the SDK looks up and calls the stored closure.

This means: if you register an action lazily (e.g. only after the user clicks something), and the user opens ⌘K before that — the action appears in the drawer (metadata was sent) but does nothing when activated (no closure stored yet). Always register actions during mount.

**4. `unregisterAction` ID must match exactly**

An earlier SDK version internally prefixed the action ID with the extension ID in `unregisterAction` but not in `registerAction`. This meant `unregisterAction('open-in-browser')` looked for `'org.asyar.tauri-docs:open-in-browser'` in the registry — which didn't exist, because `registerAction` stored it as `'open-in-browser'`. The action was never cleaned up and accumulated in the ⌘K drawer.

**Rule:** Use the exact same `id` string in both `registerAction` and `unregisterAction`. No prefix.

**5. Creating multiple `ExtensionContext` instances**

The `ExtensionContext` constructor attaches `focusin` and `focusout` event listeners to detect when the user is interacting with an input field inside the iframe. These listeners send `asyar:extension:input-focus` messages to the host, which controls whether `Backspace` navigates back or types in the field.

If you create a second context (e.g. inside a Svelte component's `onMount`), you get duplicate listeners. Every focus event sends two messages. The host processes them out of order, and the focus lock breaks intermittently — sometimes Backspace navigates away while the user is typing, sometimes focus gets "stuck" and the user can't exit the view.

**6. Stealing focus from the host search bar**

An earlier version of `DefaultView.svelte` had this in an `$effect`:

```typescript
// BAD — do not do this
$effect(() => {
  if (listContainer) listContainer.focus();
});
```

This moved DOM focus into the iframe. Once focus is in the iframe, the host's search bar no longer receives keystrokes. The user sees the cursor blinking in the search bar (it's a different DOM), but typed characters go nowhere.

Keyboard navigation in Asyar extensions works via `postMessage` (`asyar:view:keydown`), not via native DOM focus. Never call `.focus()` on an element inside the iframe unless the user clicks into it.

**7. Caching `null` results**

The first implementation of `fetchDocContent` cached the result of `parseDocHtml` regardless of whether it returned content. If a network glitch caused a partial response and the parser returned an empty string, that empty string was cached for 10 minutes. Every subsequent selection of that doc showed a blank panel with no retry.

The fix is trivial: only cache when the result is non-empty. But this kind of bug is invisible during development (where the network never fails) and only shows up in production.
