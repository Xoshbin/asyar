### `InteropService` — Invoke commands in other extensions

**Permission required:** `extension:invoke`.

Lets an extension trigger any command declared in another installed extension's `manifest.json`. This is the building block for extension composition: a workflow extension can chain steps across multiple tools, a shortcut extension can launch a specific view from another extension, and so on. Any command declared in a manifest is potentially invokable by other extensions that hold the required permission.

```typescript
export interface IInteropService {
  /**
   * Invoke a command from another installed extension.
   *
   * @param extensionId - The target extension's manifest `id`
   *                      (e.g. `'com.example.calc'`)
   * @param commandId   - The command's `id` as declared in the target manifest
   *                      (e.g. `'run'`)
   * @param args        - Optional arguments forwarded to the command
   */
  launchCommand(
    extensionId: string,
    commandId: string,
    args?: Record<string, unknown>
  ): Promise<void>
}
```

**Minimal usage:**

```typescript
import type { IInteropService } from 'asyar-sdk';

const interop = context.getService<IInteropService>('interop');

// Open the clipboard-history extension's default view
await interop.launchCommand('org.asyar.clipboard', 'show-clipboard');

// Pass arguments to the target command
await interop.launchCommand('com.example.calc', 'run', { query: '5+3' });
```

**Finding the right `extensionId` and `commandId`:**

Both values come from the target extension's `manifest.json`:

```json
{
  "id": "com.example.calc",
  "commands": [
    { "id": "run", "name": "Calculate", "description": "…" }
  ]
}
```

The `id` at the top level is the `extensionId`. The `id` inside each `commands` entry is the `commandId`.

#### How it works under the hood

```
Calling extension (iframe)              Host
────────────────────────────────────────────────────────
1. interop.launchCommand('com.example.calc', 'run', args)

2. InteropServiceProxy:
   broker.invoke('InteropService:launchCommand',
     { extensionId, commandId, args: args ?? null })
                                         ─────────────────────────────────►
                                         3. ExtensionIpcRouter:
                                            permission check (extension:invoke)
                                            inject callerExtensionId as first arg
                                         4. InteropService.launchCommand():
                                            objectId = 'cmd_com.example.calc_run'
                                            command registered?
                                              no → extension installed?
                                                    no  → throw EXTENSION_NOT_FOUND
                                                    yes → throw COMMAND_NOT_FOUND
                                            execute command via handleCommandAction
                                         ◄─────────────────────────────────
3. Promise resolves → void
```

The host validates that the target command is registered before executing it. If the target extension opens a view, the launcher's navigation stack updates exactly as if the user had selected that command from search.

#### Error handling

Errors cross the IPC boundary as plain `Error` objects with a message string. Match on the message content to distinguish error types:

```typescript
try {
  await interop.launchCommand('com.example.calc', 'run');
} catch (err) {
  if (err.message.includes('is not installed')) {
    // Target extension is not installed
  } else if (err.message.includes('not found in extension')) {
    // Extension is installed but that command ID doesn't exist
  } else if (err.message.includes('Permission denied')) {
    // extension:invoke not declared in caller's manifest
  }
}
```

| Error message pattern | Cause |
|---|---|
| `Extension "..." is not installed` | No extension with that `extensionId` is installed |
| `Command "..." not found in extension "..."` | Extension is installed but has no command with that `commandId` |
| `Permission denied: "extension:invoke"...` | `extension:invoke` missing from caller's manifest |

#### Availability

The target command must be **registered** — i.e. the target extension must be loaded and active. Built-in features (`org.asyar.*`) are always available. Third-party extensions are available after first activation (which happens on first search or explicit launch).

#### Security

- Requires `extension:invoke` in the **calling** extension's manifest.
- The host injects `callerExtensionId` into the invocation context for audit logging — the platform always knows which extension initiated the call.
- The target extension does not need to explicitly "export" commands; every command listed in its `manifest.json` is invokable.
- There is no mechanism for extensions to enumerate other extensions' commands at runtime. The caller must know the `extensionId` and `commandId` in advance (e.g., from the target extension's documentation).

---
