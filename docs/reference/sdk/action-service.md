### 8.8 `ActionService` — ⌘K action registration

**Runs in:** both worker and view. `registerActionHandler(id, fn)` is
role-neutral — register handlers that must fire while the view is
Dormant (notification action callbacks, tray-driven actions) from the
worker; register UI-bound handlers from the view.

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
