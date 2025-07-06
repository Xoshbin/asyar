# Asyar API SDK

This package (`asyar-api`) provides the Software Development Kit (SDK) for building extensions for the [Asyar application](https://github.com/Xoshbin/asyar). It defines the core interfaces, types, and services that extensions interact with.

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

This SDK is primarily intended to be used by Asyar extensions. When developing an extension, you will import types and interfaces from this package to interact with the Asyar application.

Refer to the main [Asyar Extension Development Guide](../../docs/extension-development.md) for detailed instructions on how to build extensions using this SDK.

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
} from "asyar-api";
import type { ExtensionAction, IActionService } from "asyar-api/dist/types"; // Note: Check if types are re-exported from root index

class MyExtension implements Extension {
  private logService?: ILogService;

  async initialize(context: ExtensionContext): Promise<void> {
    this.logService = context.getService<ILogService>("LogService");
    this.logService?.info("Extension initialized using asyar-api");
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
