# Asyar API SDK

This package (`asyar-sdk`) provides the Software Development Kit (SDK) for building extensions for the [Asyar application](https://github.com/Xoshbin/asyar). It defines the core interfaces, types, and services that extensions interact with.

## Purpose

The Asyar API enables developers to create extensions that integrate seamlessly with the Asyar core application. It provides access to essential services like logging, extension management, action handling, clipboard history, and notifications.

## Installation

To install the necessary dependencies for development or usage within the main Asyar project, use pnpm:

```bash
pnpm install
```

## Building

To compile the TypeScript source code into JavaScript, run the build script:

```bash
pnpm run build
```

This will generate the output files in the `dist/` directory as specified in `tsconfig.json`.

## Usage

This SDK is the bridge allowing Asyar extensions to interact with the Host Application. It dynamically adapts its behavior based on the execution context of the extension utilizing it.

Refer to the main [Asyar Architecture Guide](../../docs/extension-architecture.md) for detailed instructions on building extensions.

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

*   **Interfaces:** `Extension`, `ExtensionContext`, `ILogService`, `IExtensionManager`, `IActionService`, `IClipboardHistoryService`, `INotificationService`, etc.
*   **Types:** `ExtensionResult`, `ExtensionAction`, `ClipboardItem`, etc.

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

## Available Scripts

The following scripts are available via `pnpm run <script_name>`:

*   `build`: Compiles the TypeScript code.
*   `prepare`: Automatically runs `build` before publishing.
*   `test`: Runs tests (requires test runner setup like Jest).
*   `lint`: Lints the source code (requires linter setup like ESLint).
*   `watch`: Compiles the code in watch mode.

## Clean Installation

A utility script `clean-install.sh` is provided to completely remove build artifacts, caches, and `node_modules`, then perform a fresh installation and build.

```bash
./clean-install.sh
```

## Contributing

(Add contribution guidelines if applicable)

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

