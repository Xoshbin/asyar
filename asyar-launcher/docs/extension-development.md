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
npm install -g asyar-api
```

Verify it works:

```bash
asyar --version
```

### Project dependencies

Every extension project needs at minimum:

```bash
pnpm add asyar-api svelte
pnpm add -D vite @sveltejs/vite-plugin-svelte typescript
```

The package name for the SDK on npm is `asyar-api`. The import path inside your code is also `asyar-api`.

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

`src/main.ts` is the file Vite compiles into your bundle. It bootstraps the SDK context, signals to the host that the extension loaded, and mounts the correct Svelte component.

```typescript
// src/main.ts
import { mount } from 'svelte';
import App from './App.svelte';
import { ExtensionContext } from 'asyar-api';

// The iframe URL is asyar-extension://<extensionId>/index.html?view=<ViewName>.
// We read the extension ID from the hostname.
const extensionId = window.location.hostname || 'com.yourname.hello-world';

// Initialize the SDK context. This sets up the postMessage bridge
// that every service proxy uses to talk to the host.
const context = new ExtensionContext();
context.setExtensionId(extensionId);

// Tell the host we are ready. Without this message the host
// will not route actions or service calls to this iframe.
window.parent.postMessage(
  { type: 'asyar:extension:loaded', extensionId },
  '*'
);

// Read which view the host wants to display. The host appends
// ?view=<ViewName> to the URL when it opens the iframe.
const searchParams = new URLSearchParams(window.location.search);
const viewName = searchParams.get('view') || 'App';

// Mount the view. In a real extension with multiple views you
// would resolve viewName to the correct Svelte component here.
const app = mount(App, { target: document.getElementById('app')! });

export default app;
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

export default defineConfig({
  plugins: [svelte()],
});
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
    "asyar-api": "^1.0.0",
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

### 5.3 Inline Result Commands (`resultType: "result"` via `search()`)

Inline results appear directly in the global search bar as the user types — no panel opens unless the user selects a result that has `type: "view"`. This pattern is the right choice for calculator-style extensions, quick converters, and live-filtered lists.

**How `search(query: string)` works:**

- Called on **every keystroke** in the global search bar.
- Receives the full current query string.
- Must return `Promise<ExtensionResult[]>`.
- Return an empty array when the query is not relevant to your extension.
- The method is called across all loaded extensions in parallel; keep it fast. Avoid network calls on every keystroke — debounce or filter locally first.

**The `ExtensionResult` object:**

```typescript
interface ExtensionResult {
  title: string;         // Primary text shown in the result row
  subtitle?: string;     // Secondary text (dimmer, smaller)
  type: "result" | "view"; // "result" runs action(); "view" opens a panel
  action: () => void | Promise<void>; // Called when user presses Enter
  score: number;         // Sort weight. Higher = closer to top. Use 0.0–1.0.
  icon?: string;         // Emoji or icon identifier (optional)
  style?: "default" | "large"; // Display size hint (optional)
  viewPath?: string;     // Required when type is "view"
}
```

**Full example — a hardcoded list filter:**

In `manifest.json`, no extra command entry is required for inline results. Just implement `search()` in your extension class. Below is a complete `src/index.ts` for an extension that filters a list of cities:

```typescript
// src/index.ts
import type { Extension, ExtensionContext, ExtensionResult } from 'asyar-api';

const CITIES = ['Amsterdam', 'Berlin', 'Cairo', 'Delhi', 'Edinburgh', 'Florence'];

class CitySearchExtension implements Extension {
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

    const q = query.toLowerCase();
    return CITIES
      .filter(city => city.toLowerCase().includes(q))
      .map((city, index) => ({
        title: city,
        subtitle: 'Press Enter to copy city name',
        type: 'result' as const,
        score: 1 - index * 0.1,
        action: async () => {
          await navigator.clipboard.writeText(city);
          this.extensionManager?.goBack();
        },
      }));
  }
}

export default new CitySearchExtension();
```

> 📸 **[SCREENSHOT PLACEHOLDER: Inline search results from a third-party extension appearing in the global Asyar search bar as the user types, showing city names filtered in real time]**

---

## 6. The SDK — Available Services

All services are accessed through `ExtensionContext.getService<T>(serviceName)`. The context is set up in `main.ts` and the extension ID must be set before calling any service.

```typescript
import { ExtensionContext } from 'asyar-api';
import type { INotificationService } from 'asyar-api';

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

// Update the label shown in the bottom action bar
manager.setActiveViewActionLabel('Save');
manager.setActiveViewActionLabel(null); // clear
```

The `viewPath` format is `<extensionId>/<ViewComponentName>`. The host translates this into the iframe URL `asyar-extension://<extensionId>/index.html?view=<ViewComponentName>`.

---

## 7. Actions — The ⌘K Panel

Actions are keyboard-accessible commands that appear in Asyar's Action Drawer when the user presses **⌘K**. They are contextual — different actions are available depending on whether a view is open, what command is active, and what your extension registers.

### What actions are for

Use actions for secondary operations that are relevant only while the user is looking at your view — "Refresh", "Export", "Toggle Filter", "Copy All", etc. They complement, rather than replace, the UI controls inside your view.

### Registering an action

Register actions after your view is mounted. Actions are registered by calling `ActionService.registerAction()` on the service proxy:

```typescript
import type { IActionService, ExtensionAction, ActionContext } from 'asyar-api';

// Inside main.ts or a Svelte component's onMount callback:
const actionService = context.getService<IActionService>('ActionService');

const refreshAction: ExtensionAction = {
  id: 'com.yourname.my-extension:refresh',
  title: 'Refresh',
  description: 'Re-fetch data from the source',
  icon: '↻',
  extensionId: 'com.yourname.my-extension',
  category: 'view-action',
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
  import type { IActionService } from 'asyar-api';

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
| `category` | `string` | ❌ | Group label for grouping related actions in the drawer. |
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
| `network` | Make outbound HTTP requests | `NetworkService.fetch()` (future) |

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

```typescript
import { mount } from 'svelte';
import BookmarksView from './BookmarksView.svelte';
import { ExtensionContext } from 'asyar-api';
import type { INotificationService } from 'asyar-api';

const extensionId = window.location.hostname || 'com.yourname.bookmarks';

const context = new ExtensionContext();
context.setExtensionId(extensionId);

// Signal readiness to the host
window.parent.postMessage({ type: 'asyar:extension:loaded', extensionId }, '*');

// Handle no-view command invocations relayed from the host
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

      const notif = context.getService<INotificationService>('NotificationService');
      await notif.notify({ title: 'Bookmark Added', body: entry });
    }
  }
});

// Determine view
const viewName = new URLSearchParams(window.location.search).get('view') || 'BookmarksView';

// Mount view
if (viewName === 'BookmarksView') {
  mount(BookmarksView, { target: document.getElementById('app')!, props: { context } });
}
```

### `src/BookmarksView.svelte`

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { ExtensionContext, IActionService, INotificationService, ActionContext } from 'asyar-api';

  export let context: ExtensionContext;

  let bookmarks: string[] = [];
  let query = '';
  let actionService: IActionService;
  let notifService: INotificationService;

  const ACTION_ID = 'com.yourname.bookmarks:clear-all';

  $: filtered = query
    ? bookmarks.filter(b => b.toLowerCase().includes(query.toLowerCase()))
    : bookmarks;

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

    actionService = context.getService<IActionService>('ActionService');
    notifService = context.getService<INotificationService>('NotificationService');

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
    actionService?.unregisterAction(ACTION_ID);
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
import type { Extension, ExtensionContext, ExtensionResult } from 'asyar-api';

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
| `asyar link` uses file copy mode instead of symlink | Filesystem permissions or Windows without admin | This is safe — use `asyar build` after every change and the copy will be updated; or run the CLI with elevated permissions to restore symlink mode |

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

External fetch calls from inside the iframe are blocked by the Content Security Policy (`default-src asyar-extension: 'self'`). To make outbound HTTP requests, declare the `network` permission and use the `NetworkService` SDK service when it becomes available. For now, any outbound requests must be routed through the host via the SDK.

> ⚠️ **[AUTHOR NOTE: `NetworkService` is listed in the permission gate's architecture strings (`asyar:service:NetworkService:fetch → network`) but no SDK proxy implementation was found in the current codebase. Verify availability before documenting as usable.]**

**Q: Can my extension store persistent data?**

Within the iframe you have access to `localStorage` and `sessionStorage` — these are scoped to the `asyar-extension://<id>` origin, so each extension has its own isolated storage. For application-managed key-value storage (backed by Tauri's store plugin), use `StoreService` with `store:read` / `store:write` permissions when that service becomes available.

**Q: Can my extension open external URLs or launch other applications?**

Not directly from within the iframe sandbox. Use `window.open()` — the `allow-popups` sandbox token permits this. For opening URLs in the user's default browser or launching applications, route the call through the host via `ShellService` (requires `shell:execute` permission).

**Q: How do I pass data from the launcher (command arguments) into my view?**

The `view` URL includes a `?view=<ViewName>` parameter. At present, there is no built-in mechanism for passing arbitrary command arguments into the URL. The recommended pattern is to store state in `localStorage` from a no-view command, then read it when the view mounts, or to use the `search` method to pass query context.

> ⚠️ **[AUTHOR NOTE: Confirm whether the host sends a `postMessage` with command args after the iframe loads, and document that pattern here if confirmed.]**

**Q: My extension registered an action but ⌘K doesn't show it — why?**

The `execute` function on `ExtensionAction` is not serialized over IPC — only the action metadata (`id`, `title`, `description`, `icon`, `category`, `context`) is sent to the host. The host stores the metadata and renders it in the drawer. When the user activates the action, the host sends a `postMessage` back to the iframe, and the SDK's `ActionServiceProxy` calls the locally registered `execute` function. This means `execute` must be registered before the action can be triggered. Ensure `registerAction()` is called during `onMount` and not lazily.

**Q: Can I have multiple views in one extension?**

Yes. Add multiple Svelte component files in `src/`. In `main.ts`, resolve `viewName` from `window.location.search` and conditionally mount the correct component. Use `extensionManager.navigateToView('com.yourname.my-ext/DetailView')` from within any view to navigate to another.

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
