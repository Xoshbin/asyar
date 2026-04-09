### 8.8 `ActionService` — ⌘K action registration

**Permission required:** None.

See the [actions reference](../actions.md) for the complete guide.

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
