---
order: 4
---
## 9. Actions — The ⌘K Panel

Actions are keyboard-accessible commands that appear in Asyar's Action Drawer when the user presses **⌘K**. They are **contextual** — what appears depends on where the user is and what your extension has registered.

There are two ways to contribute actions:

| Approach | When to use |
|---|---|
| **Manifest-declared actions** | Root search — appear when the user selects your command in the main launcher, before opening any view. Declared in `manifest.json`. |
| **Programmatic actions** | View-level — appear while your extension panel is open. Registered in code via `actionService.registerAction()`. |

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

const actionService = context.getService<IActionService>('actions');

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

---

## Manifest-declared actions

Manifest-declared actions let your extension contribute entries to the ⌘K drawer directly from the **root search** — without the user opening your extension view first. This is unique to Asyar: Raycast confines extension actions to their own command views.

### How it works

1. Declare actions in `manifest.json` under the root `actions` array (extension-level) or inside an individual command's `actions` array (command-level).
2. Register a handler in your extension code using `context.actions.registerActionHandler(actionId, handler)`.
3. When the user highlights your command in the main search list and presses ⌘K, the declared actions appear automatically.
4. When the user selects an action, Asyar relays the request to your extension. The registered handler runs in your extension context.

### Visibility rules

| Declaration | Visible when |
|---|---|
| Extension-level `actions[]` | Any command from your extension is highlighted in the root search |
| Command-level `actions[]` | That specific command is highlighted |

Both levels combine when the highlighted command has its own `actions` — the user sees extension-level actions plus that command's actions together.

### Declaring actions in manifest.json

```json
{
  "id": "com.example.github",
  "name": "GitHub",
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
      "description": "Find GitHub repositories",
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

### Registering handlers in code

Register handlers in your extension's `initialize()` or `activate()` method:

```typescript
import type { Extension, ExtensionContext } from 'asyar-sdk';

class GitHubExtension implements Extension {
  async initialize(context: ExtensionContext): Promise<void> {
    // Extension-level action — runs whenever user selects any GitHub command
    context.actions.registerActionHandler('open-settings', async () => {
      // Open settings panel, navigate, etc.
    });

    // Command-level action — runs when user selects "search-repos" and activates "clone-repo"
    context.actions.registerActionHandler('clone-repo', async () => {
      // Clone the currently-relevant repository
    });
  }

  // ...
}
```

`registerActionHandler(actionId, handler)` — `actionId` is the short local ID you declared in `manifest.json` (e.g. `"clone-repo"`), **not** the full internal ID. The host constructs the full ID as `act_{extensionId}_{actionId}` internally.

### Validation

The Rust extension loader validates action declarations at discovery time. Invalid extensions are skipped with a warning:

- **ID regex:** `/^[a-zA-Z][a-zA-Z0-9_-]*$/` — must start with a letter, contain only letters, digits, underscores, or hyphens
- **Non-empty title:** Every declared action must have a non-empty `title`
- **Unique IDs within extension:** Action IDs must be unique across both extension-level and command-level declarations in the same extension (no cross-scope duplicates)

### ManifestAction field reference

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | ✅ | Local identifier. Must be unique within the extension. |
| `title` | `string` | ✅ | Label shown in the ⌘K action drawer. |
| `description` | `string` | ❌ | Secondary text below the title. |
| `icon` | `string` | ❌ | Emoji or `"icon:<name>"`. |
| `shortcut` | `string` | ❌ | Keyboard hint displayed in the drawer (display-only). |
| `category` | `string` | ❌ | Groups related actions under a heading. |

---

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
