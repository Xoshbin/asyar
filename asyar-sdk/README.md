# Asyar SDK

This package (`asyar-sdk`) provides the Software Development Kit (SDK) for building extensions for the [Asyar Launcher](https://github.com/Xoshbin/asyar). It defines the core interfaces, types, and services that extensions interact with.

## Purpose

The Asyar SDK enables developers to create extensions that integrate seamlessly with the Asyar core application. It provides access to essential services like logging, extension management, action handling, clipboard history, and notifications.

## For Extension Developers

Install the SDK as a dependency in your extension project:

```bash
npm install -g asyar-sdk   # installs the CLI globally
```

Or add it to your project:

```bash
pnpm add asyar-sdk
```

### CLI Commands

The `asyar` CLI drives the full extension development workflow:

| Command | Description |
|---------|-------------|
| `asyar dev` | Start development mode with hot reload |
| `asyar build` | Production build of your extension |
| `asyar validate` | Check manifest and project structure |
| `asyar link` | Symlink your extension into the app's extensions directory |
| `asyar attach` | Register an extension directory for dev loading in the launcher |
| `asyar detach` | Unregister a dev extension from the launcher |
| `asyar publish` | Build, package, and publish to the Asyar Store |
| `asyar doctor` | Diagnose environment issues |
| `asyar --version` | Show CLI version |

### Pre-Publish Safety

The `publish` command includes automatic guards:
- **Stale build detection** — blocks publishing if source files are newer than the build output
- **Duplicate version check** — blocks publishing if the version is already live in the store

### Dev Loading Workflow

The `attach` and `detach` commands enable a fast developer loop:

1. **Attach**: `asyar attach .` — Builds the extension and registers its current directory with the Asyar App. The launcher will now load this extension directly from your project folder during development.
2. **Bulk Attach**: `asyar attach --all /path/to/extensions` — Scans for and attaches all extensions in a category/folder.
3. **Detach**: `asyar detach` — Removes the dev registration.

Unlike `asyar link`, which uses symlinks/copying into a specialized system directory, `attach` allows the launcher to read your project in-place (respecting your development build outputs).

## For Core Developers

If you are contributing to the SDK itself, use the workspace setup described in the [Asyar README](https://github.com/Xoshbin/asyar#development-setup).

### Building

The SDK has two build targets — the **library** (types/interfaces for extensions) and the **CLI** (developer tools):

```bash
pnpm run build       # library only (tsconfig.json → dist/)
pnpm run build:cli   # CLI only (tsconfig.cli.json → dist/cli/)
pnpm run build:all   # both (recommended)
```

The `prepare` script runs `build:all` automatically on `pnpm install`, so the CLI is always compiled when dependencies are installed.

### Workspace Integration

When used inside the recommended workspace layout, the SDK is symlinked into sibling packages:

```
Asyar-Project/
  ├── asyar/          → asyar/node_modules/asyar-sdk symlinks here
  ├── asyar-sdk/      → you are here
  └── extensions/     → extensions/*/node_modules/asyar-sdk symlinks here
```

After editing SDK source, run `pnpm run build:all` — changes are instantly available to all linked packages. No manual copying needed.

### Releasing

SDK releases are tag-based. From inside `asyar-sdk/`, run `pnpm run release <patch|minor|major|beta|x.y.z>` — the script bumps the version, commits, tags as `sdk-v*`, and pushes. The `release-sdk.yml` workflow then builds, publishes to npm, and creates a GitHub Release. Full flow documented at [the monorepo's RELEASING.md](../RELEASING.md#releasing-the-sdk-npm-package).

## Usage

This SDK is the bridge between Asyar extensions and the host application. The package has **no default export** — extensions and the launcher must import from one of three explicit subpaths, picked according to where the code runs.

Refer to the [Extension Development Guide](https://github.com/Xoshbin/asyar/blob/main/docs/extension-development.md) for detailed instructions on building extensions.

### Subpath exports

| Subpath | Asserts | Surface | Use from |
|---|---|---|---|
| `asyar-sdk/worker` | `window.__ASYAR_ROLE__ === "worker"` at module load | `ExtensionContext` bound to the **worker proxy bag** (no DOM-dependent helpers) — `log`, `notifications`, `storage`, `cache`, `network`, `shell`, `ai`, `oauth`, `fs`, `application`, `power`, `systemEvents`, `timers`, `statusBar`, `state`, `commands`, `actions` | A Tier 2 extension's `worker.html` (the always-on hidden iframe). |
| `asyar-sdk/view` | `window.__ASYAR_ROLE__ === "view"` at module load | Re-exports the full SDK surface plus DOM helpers (`registerIconElement`, theme injector). `ExtensionContext` is bound to the **full proxy bag** including view-only services: `clipboard`, `selection`, `interop`, `feedback`, plus the worker-shared services above. | A Tier 2 extension's `view.html` (the on-demand UI iframe). |
| `asyar-sdk/contracts` | Nothing — neutral, launcher-safe | Types, namespace constants, `MessageBroker`, `ExtensionBridge`, `ExtensionContextCore`. **No role assertion**, no top-level DOM requirement. | Launcher code (Tier 1 host, built-in features), SDK-internal modules, anything that needs types + IPC primitives without committing to an iframe role. |

The role assertion fires at module load. If a worker bundle imports
`asyar-sdk/view` (or vice-versa), execution stops with a clear error
before any proxy is constructed — the misimport is mechanically
impossible to ship to users.

### Choosing the right entry — decision tree

```
Is the code running inside a Tier 2 extension iframe?
├─ no  → asyar-sdk/contracts
│        (launcher host code, Tier 1 built-in features, neutral types)
│
└─ yes → Is it the always-on worker (worker.html)?
         ├─ yes → asyar-sdk/worker
         │        (registerActionHandler, push subscriptions,
         │         schedules, timers, tray writes, RPC handlers,
         │         search() for searchable extensions)
         │
         └─ no, it's the view (view.html)
                  → asyar-sdk/view
                    (Svelte components, DOM helpers, view-search,
                     RPC callers via context.request)
```

If the extension has both a worker and a view, you ship two bundles —
one entry per HTML file.

### Manifest version policy — `asyarSdk`

Each manifest declares an `asyarSdk` semver range (e.g. `"^2.0.0"`):

- The host validates the bundled SDK version against this range at extension discovery. An incompatible extension is marked unloaded — its iframes are not materialised.
- The check is range-based; pin loosely (`^2`) for forward compatibility on minor versions, tightly (`~2.1.0`) only when you depend on a specific patch.
- Major SDK bumps are breaking by definition — extensions need to update to the new entry-points or proxy bag and re-publish.

### Tier 2 vs Tier 1

Tier 2 extensions ship as compiled bundles loaded into sandboxed iframes;
they go through `asyar-sdk/worker` and `asyar-sdk/view`. Tier 1 (built-in
features inside the launcher repo) imports from `asyar-sdk/contracts` —
they run in the launcher's JS context with full Tauri API access and do
not need (or want) a role assertion.

> [!WARNING]
> **IPC Payload Requirements for SDK Contributors:**
> When adding new proxy boundaries, you MUST send payloads as named-key property objects where keys correspond to the Host's parameter names in order (e.g., `broker.invoke('method', { query, limit })`).
> Sending raw primitives will cause the generic deserializer inside the Asyar Host to convert the argument into `"[object Object]"`, silently breaking the pipeline.

### Example — worker entry

```typescript
// src/main.worker.ts — loaded by worker.html
import { ExtensionContext, extensionBridge } from 'asyar-sdk/worker';
import type { ILogService, INotificationService } from 'asyar-sdk/contracts';

const extensionId = window.location.hostname;
const context = new ExtensionContext();
context.setExtensionId(extensionId);

const log = context.getService<ILogService>('log');
log?.info('Worker bootstrapped');

// view → worker RPC handler (only available on the worker entry).
context.onRequest<{}, { rounds: number }>('getStats', async () => {
  return { rounds: await readRounds() };
});

window.parent.postMessage({ type: 'asyar:extension:loaded', extensionId, role: 'worker' }, '*');
```

### Example — view entry

```typescript
// src/main.view.ts — loaded by view.html
import { ExtensionContext, registerIconElement } from 'asyar-sdk/view';
import MyView from './MyView.svelte';
import { mount } from 'svelte';

registerIconElement();

const extensionId = window.location.hostname;
const context = new ExtensionContext();
context.setExtensionId(extensionId);

mount(MyView, { target: document.getElementById('app')!, props: { context } });

window.parent.postMessage({ type: 'asyar:extension:loaded', extensionId, role: 'view' }, '*');
```

### Extension Icons

Add an `icon` field to your manifest to show a branded icon next to your commands in the launcher search results.

#### Supported icon formats

| Format | Example | Where rendered |
|--------|---------|----------------|
| Built-in icon | `"icon:calculator"` | Manifests, commands, search results, actions — rendered by the host |
| Emoji | `"👋"` | Manifests, commands, search results, actions — rendered by the host |
| Web URL | `"https://example.com/icon.png"` | Commands and search results — rendered by the host |
| Local path | `"assets/icon.png"` | Commands and search results — rendered by the host |

#### Rendering built-in icons in extension iframes

Use the `<asyar-icon>` custom element to render built-in icons inside your extension views. Icons are rendered as SVGs with `viewBox="0 0 24 24"`, `fill="none"`, and `stroke="currentColor"`.

```html
<!-- Register the element (usually in your main.ts) -->
<!-- import { registerIconElement } from 'asyar-sdk'; -->
<!-- registerIconElement(); -->

<!-- Use in your HTML/Svelte/React templates -->
<asyar-icon name="calculator" size="20" stroke="2"></asyar-icon>
```

| Attribute | Default | Description |
|-----------|---------|-------------|
| `name` | (required) | The name of the built-in icon (e.g., `calculator`, `settings`) |
| `size` | `24` | The width and height of the SVG in pixels |
| `stroke` | `1.5` | The `stroke-width` of the icon paths |

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

### Design Tokens & Theming

The Asyar host automatically injects two things into every extension iframe:

- **Design tokens** — the full set of CSS custom properties (`var(--token-name)`)
- **Fonts** — Satoshi and JetBrains Mono are delivered as base64 data URIs so `var(--font-ui)` and `var(--font-mono)` render the real typefaces, not system fallbacks

No setup needed — just use the variables in your CSS.

**Theme changes are live.** When the user switches between light and dark mode, the host re-injects updated token values. Your extension's UI updates without a reload. Fonts are sent once on load and cached.

```css
.card {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--separator);
  border-radius: var(--radius-md);
  padding: var(--space-6);
}
```

During development, import the static fallback file for IDE autocomplete and neutral defaults:

```javascript
// vite.config or main.ts
import 'asyar-sdk/tokens.css';
```

Available token categories

| Category | Variables |
|---|---|
| Backgrounds | --bg-primary, --bg-secondary, --bg-tertiary, --bg-hover, --bg-selected, --bg-popup |
| Text | --text-primary, --text-secondary, --text-tertiary |
| Borders | --border-color, --separator |
| Accent | --accent-primary, --accent-success, --accent-warning, --accent-danger |
| Brand | --asyar-brand, --asyar-brand-hover, --asyar-brand-muted, --asyar-brand-subtle |
| Shadows | --shadow-xs → --shadow-xl, --shadow-popup, --shadow-focus |
| Radius | --radius-xs → --radius-full |
| Spacing | --space-1 (4px) → --space-11 (48px) |
| Font sizes | --font-size-2xs (10px) → --font-size-display (2.25rem) |
| Font families | --font-ui (Satoshi), --font-mono (JetBrains Mono) |
| Transitions | --transition-fast, --transition-normal, --transition-smooth, --transition-slow |

See tokens.css for the full list with fallback values.

### Platform Compatibility

Add a `platforms` field to your manifest to restrict your extension to specific operating systems. Extensions that don't support the current OS are hidden in the store and blocked from loading by the host.

```json
{
  "id": "com.example.my-extension",
  "platforms": ["macos", "linux"],
  "commands": [...]
}
```

Valid values: `"macos"`, `"windows"`, `"linux"`. You can list any combination.

**Omit the field entirely for a universal extension** — that is the default. The `asyar validate` command enforces the allowed values and rejects anything outside the list.

| Manifest value | Behaviour |
|---|---|
| Field absent | Works on all platforms (universal) |
| `["macos"]` | macOS only |
| `["macos", "linux"]` | macOS and Linux, not Windows |
| `["windows", "linux"]` | Windows and Linux, not macOS |

## Available Scripts

| Script | Description |
|--------|-------------|
| `build` | Compiles the SDK library (types, interfaces, proxies) |
| `build:cli` | Compiles the CLI tool |
| `build:all` | Compiles both SDK library and CLI |
| `prepare` | Runs `build:all` automatically on install |
| `watch` | Compiles the SDK library in watch mode |

## License

Distributed under the AGPLv3 License. See LICENSE.md for more information.

## Actions — The ⌘K Panel

There are two ways to contribute actions to Asyar's ⌘K panel:

### 1. Manifest-declared actions (root search)

Declare actions directly in `manifest.json`. These appear in the ⌘K drawer while the user has your command highlighted in the **main search results** — before opening any view.

**`manifest.json`:**
```json
{
  "id": "com.example.github",
  "actions": [
    {
      "id": "open-settings",
      "title": "Extension Settings",
      "icon": "icon:settings",
      "shortcut": "⌘,",
      "category": "System"
    }
  ],
  "commands": [
    {
      "id": "search-repos",
      "name": "Search Repositories",
      "mode": "view",
      "component": "RepoSearch",
      "actions": [
        {
          "id": "clone-repo",
          "title": "Clone Repository",
          "icon": "icon:download",
          "shortcut": "⌘⇧C",
          "category": "Primary"
        }
      ]
    }
  ]
}
```

Register handlers in your extension's `initialize()` or `activate()`. With the worker/view split, `registerActionHandler` is role-neutral — it works from either role's `ExtensionContext`. Choose the role based on whether the action needs to fire while the panel is closed:

```typescript
// Worker entry — handles actions that must survive the view being Dormant
// (notification action callbacks, tray-driven actions, etc.)
class GitHubExtension implements Extension {
  async initialize(context: ExtensionContext): Promise<void> {
    context.actions.registerActionHandler('open-settings', async () => {
      // your handler — fires even when no view is open
    });
  }
}

// View entry — handles actions that only make sense while the panel is open
class GitHubView implements Extension {
  async initialize(context: ExtensionContext): Promise<void> {
    context.actions.registerActionHandler('clone-repo', async () => {
      // your handler — uses DOM / view state
    });
  }
}
```

The `actionId` you pass to `registerActionHandler` is the short local ID from `manifest.json`, not the full internal ID (`act_{extensionId}_{actionId}`).

**Visibility rules:**
- Root-level `actions[]` — visible when **any** command from your extension is highlighted
- Command-level `actions[]` — visible only when **that specific command** is highlighted

### 2. Programmatic actions (inside extension views)

Register actions in code from your extension view components. These appear while your extension panel is open.

```typescript
import { ActionContext, ActionCategory } from 'asyar-sdk/view';

actionService.registerAction({
  id: 'my-extension:do-thing',
  title: 'Do Something',
  description: 'A helpful description shown in the panel',
  icon: '✨',
  category: ActionCategory.PRIMARY,
  extensionId: context.extensionId,
  context: ActionContext.EXTENSION_VIEW,
  execute: async () => {
    // your action logic
  }
})
```

Always unregister in `onDestroy` to prevent stale actions persisting across views.

### Standard categories (`ActionCategory`)

| Constant | Display name | Use for |
|----------|-------------|---------|
| `ActionCategory.PRIMARY` | Primary | Main actions for the extension |
| `ActionCategory.NAVIGATION` | Navigation | Opening views, going back |
| `ActionCategory.EDIT` | Edit | Create, update, delete operations |
| `ActionCategory.SHARE` | Share | Export, copy, send |
| `ActionCategory.DESTRUCTIVE` | Destructive | Irreversible actions (delete, reset) |
| `ActionCategory.SYSTEM` | System | Reserved for built-in host actions |

Custom strings are always allowed. `ActionCategory` provides recommended names for consistency across extensions. If no `category` is set, the ⌘K panel automatically groups the action under the extension's display name.

