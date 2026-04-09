## 9. Actions — The ⌘K Panel

Actions are keyboard-accessible commands that appear in Asyar's Action Drawer when the user presses **⌘K**. They are **contextual** — what appears depends on where the user is and what your extension has registered.

### What actions are for

Use actions for secondary operations relevant while the user is looking at your view: "Refresh", "Export CSV", "Toggle Filter", "Clear All", "Copy Link". They complement, rather than replace, the UI controls inside your view.

### How the execute function survives the iframe boundary

The `execute` function is a live JavaScript closure. It **cannot be serialized over postMessage**. The SDK uses a two-registry approach:

1. When you call `registerAction({ id, ..., execute })`, the SDK stores the closure locally in the iframe's `ExtensionBridge.actionRegistry`. Only the metadata (`id`, `title`, `icon`, etc.) is sent to the host.
2. When the user activates an action from the ⌘K Drawer, the host sends `asyar:action:execute` to the correct iframe.
3. The SDK receives the message, looks up the `execute` closure in `actionRegistry`, and calls it.

### Registering actions

Register actions after your view is mounted:

```typescript
import { ActionContext, ActionCategory } from 'asyar-sdk';
import type { IActionService, ExtensionAction } from 'asyar-sdk';

const actionService = context.getService<IActionService>('ActionService');

const refreshAction: ExtensionAction = {
  id: 'com.yourname.myext:refresh',   // Must be globally unique. Use your ext ID as namespace.
  title: 'Refresh',
  description: 'Re-fetch data from source',
  icon: '↻',
  extensionId: 'com.yourname.myext',
  category: ActionCategory.PRIMARY,
  context: ActionContext.EXTENSION_VIEW,
  execute: async () => {
    await loadData();
  },
};

actionService.registerAction(refreshAction);
```

### Svelte 5 lifecycle pattern — register and cleanup

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ActionContext, ActionCategory } from 'asyar-sdk';
  import type { IActionService } from 'asyar-sdk';

  interface Props {
    actionService: IActionService;
  }
  let { actionService }: Props = $props();

  const ACTION_ID = 'com.yourname.myext:refresh';

  onMount(() => {
    actionService.registerAction({
      id: ACTION_ID,
      title: 'Refresh',
      description: 'Reload the data',
      icon: '↻',
      extensionId: 'com.yourname.myext',
      category: ActionCategory.PRIMARY,
      context: ActionContext.EXTENSION_VIEW,
      execute: () => reload(),
    });
  });

  // Critical: always unregister on unmount.
  // If you leave actions registered, they pollute the ⌘K panel for other views.
  onDestroy(() => {
    actionService.unregisterAction(ACTION_ID);
  });

  function reload() { /* ... */ }
</script>
```

> ⚠️ **Always unregister actions when the view unmounts.** Registered actions survive view navigation. If you forget `onDestroy` cleanup, your actions accumulate and appear in the ⌘K drawer for completely unrelated views.

> ⚠️ **Pass the bare action ID to `unregisterAction()`** — the exact string you passed to `id` in `registerAction`. Do not add any prefix.

### Action field reference

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | ✅ | Globally unique. Namespace with your extension ID: `com.yourname.ext:action-name` |
| `title` | `string` | ✅ | Label shown in the Action Drawer. |
| `extensionId` | `string` | ✅ | Your extension's `id` from `manifest.json`. |
| `execute` | `() => void \| Promise<void>` | ✅ | Called when the user activates the action. |
| `description` | `string` | ❌ | Secondary text shown below the title. |
| `icon` | `string` | ❌ | Emoji or `"icon:<name>"` shown next to the title. |
| `category` | `string` | ❌ | Group label. Use `ActionCategory` constants for standard groups. |
| `context` | `ActionContext` | ❌ | When this action is visible. Default: always visible. |

### Action context reference

| `ActionContext` | When shown |
|---|---|
| `GLOBAL` | Always — regardless of what's open |
| `EXTENSION_VIEW` | Only while an extension panel is open |
| `SEARCH_VIEW` | While the main search result list is active |
| `RESULT` | When a specific result item is highlighted |
| `COMMAND_RESULT` | After a command has returned a result |
| `CORE` | Built-in Asyar actions — do not use in extensions |

### Standard action categories

| Constant | Display String | Use for |
|---|---|---|
| `ActionCategory.PRIMARY` | Primary | Main operations for the current view |
| `ActionCategory.NAVIGATION` | Navigation | Opening views, going back, drill-down |
| `ActionCategory.EDIT` | Edit | Create, update, delete operations |
| `ActionCategory.SHARE` | Share | Export, copy to clipboard, send |
| `ActionCategory.DESTRUCTIVE` | Destructive | Irreversible actions — delete, clear, reset |
| `ActionCategory.SYSTEM` | System | Reserved for built-in Asyar actions |

Custom category strings are fully supported — use them for domain-specific grouping.

---
