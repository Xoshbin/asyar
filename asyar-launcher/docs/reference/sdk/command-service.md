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
