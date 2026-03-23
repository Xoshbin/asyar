# Asyar SDK

This package (`asyar-sdk`) provides the Software Development Kit (SDK) for building extensions for the [Asyar Launcher](https://github.com/Xoshbin/asyar-launcher). It defines the core interfaces, types, and services that extensions interact with.

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
| `asyar publish` | Build, package, and publish to the Asyar Store |
| `asyar doctor` | Diagnose environment issues |
| `asyar --version` | Show CLI version |

### Pre-Publish Safety

The `publish` command includes automatic guards:
- **Stale build detection** — blocks publishing if source files are newer than the build output
- **Duplicate version check** — blocks publishing if the version is already live in the store

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

### Releasing to npm

```bash
node scripts/release.js patch   # or: minor, major
```

This bumps the version in `package.json`, commits, tags, and pushes. It also updates the SDK version fallback in the Asyar app (if present as a sibling repo). Then publish to npm:

```bash
pnpm publish
```

## Usage

This SDK is the bridge allowing Asyar extensions to interact with the Host Application. It dynamically adapts its behavior based on the execution context of the extension utilizing it.

Refer to the [Extension Development Guide](https://github.com/Xoshbin/asyar-launcher/blob/main/docs/extension-development.md) for detailed instructions on building extensions.

### Dual-Tier Architecture Support

The SDK supports two distinct environments seamlessly:

1. **Tier 1 (Built-in Extensions):**
   * These extensions run directly inside the main Asyar Window context.
   * The SDK bypasses strict `<iframe>` security verifications.
   * `MessageBroker` requests automatically resolve against Host services synchronously.
2. **Tier 2 (Installed Extensions):**
   * These extensions are executed within strictly isolated, secure `<iframe>` sandboxes.
   * The SDK transparently serializes all Native SDK queries (such as navigating to a view, throwing a notification, checking the clipboard) into remote `postMessage` IPC payloads.
   * The Host Application intercepts these simulated payloads, validates the iframe's `extensionId`, unpacks the variables via positional mapping, and returns a Promise.

> [!WARNING]
> **IPC Payload Requirements for SDK Contributors:**
> When adding new proxy boundaries to `ExtensionManagerProxy`, you MUST send payloads as named-key property objects where keys correspond to the Host's parameter names in order (e.g., `broker.invoke('method', { query, limit })`).
> Sending raw primitives will cause the generic deserializer inside the Asyar Host to convert the argument into `"[object Object]"`, silently breaking the pipeline.

Key exports include:

*   **Interfaces:** `Extension`, `ExtensionContext`, `ILogService`, `IExtensionManager`, `IActionService`, `IClipboardHistoryService`, `INotificationService`, `IStatusBarService`, etc.
*   **Types:** `ExtensionResult`, `ExtensionAction`, `ClipboardItem`, `IStatusBarItem`, etc.
*   **Proxies:** `StatusBarServiceProxy` and others providing safe cross-context RPC.

Example import in an extension's `index.ts`:

```typescript
import type {
  Extension,
  ExtensionContext,
  ExtensionResult,
  ILogService,
  IExtensionManager,
} from "asyar-sdk";
import type { ExtensionAction, IActionService } from "asyar-sdk";

class MyExtension implements Extension {
  private logService?: ILogService;

  async initialize(context: ExtensionContext): Promise<void> {
    this.logService = context.getService<ILogService>("LogService");
    this.logService?.info("Extension initialized using asyar-sdk");
  }

  // ... other methods
}

export default new MyExtension();
```

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

## Registering Actions

Extensions can register actions that appear in the ⌘K panel. Actions support optional grouping via the `category` field and icons via `icon`.

```typescript
import { ActionContext, ActionCategory } from 'asyar-sdk';

actionService.registerAction({
  id: 'my-extension:do-thing',
  title: 'Do Something',
  description: 'A helpful description shown in the panel',
  icon: '✨',
  category: ActionCategory.PRIMARY,   // Optional — groups related actions
  extensionId: context.extensionId,
  context: ActionContext.GLOBAL,
  execute: async () => {
    // your action logic
  }
})
```

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

