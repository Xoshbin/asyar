### 8.7 `CommandService` — Runtime command registration

**Runs in:** both worker and view. `commands.onCommand(id, handler)` for a
manifest command with `mode: "background"` must register from the worker
— that's where the launcher dispatches it.

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
  updateCommandMetadata(
    commandId: string,
    metadata: { subtitle?: string }
  ): Promise<void>;
}
```

#### `updateCommandMetadata(commandId, metadata)`

Updates a command's runtime metadata. Currently supports setting the **subtitle** — the secondary line of text shown beneath the command name in search results.

**Permission required:** None. Ownership is enforced by the host: you can only update commands belonging to your own extension.

```typescript
// Show a live value next to the command name in search results
await context.commandService.updateCommandMetadata('check-weather', {
  subtitle: '72 °F — San Francisco',
});

// Clear the subtitle
await context.commandService.updateCommandMetadata('check-weather', {
  subtitle: undefined,
});
```

The subtitle is persisted to the SQLite database immediately, so it survives app restarts. It appears in the search results list under the command name alongside the extension icon.

**Notes:**
- `commandId` is the short ID declared in your manifest (e.g. `"check-weather"`), not the full object ID.
- Passing `subtitle: undefined` (or omitting `subtitle`) clears the subtitle.
- Calling this on a command that does not belong to your extension throws an error.

---
