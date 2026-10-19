---
order: 4
---

## 9. Actions — The ⌘K Panel

Actions are keyboard-accessible commands that appear in Asyar's Action Drawer when the user presses **⌘K**. They are **contextual** — what appears depends on where the user is and what your extension has registered.

Actions are registered in code with `actionService.registerAction()` and appear while your extension panel is open. Asyar has no manifest-declared actions on root-search rows: to expose something without opening a view, declare another **command** (a `background` command runs immediately and can show a HUD or toast); for anything view-specific, register an action inside the view.

> **Deprecated: manifest `actions`.** Earlier versions let `manifest.json` declare `actions` (extension- and command-level) that showed on the root-search row. That feature was removed. Manifests that still declare them keep loading — the field is ignored and the launcher logs a notice — but it is rejected from launcher 0.2.0, and `asyar build` / `asyar validate` warn about it now. Move those actions into your view with `registerAction`, or declare another command.

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
  id: 'com.yourname.myext:refresh', // Must be globally unique. Use your ext ID as namespace.
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

  function reload() {
    /* ... */
  }
</script>
```

> 💡 **Automatic Scoping & Teardown:** The launcher automatically scopes `EXTENSION_VIEW` actions to the currently active extension ID. Navigating between extension views automatically clears actions registered by the previous extension and switches context to the new extension. Unregistering via `onDestroy` remains recommended best practice for component hygiene within the same extension.

> ⚠️ **Pass the bare action ID to `unregisterAction()`** — the exact string you passed to `id` in `registerAction`. Do not add any prefix.

### Action field reference

| Field         | Type                          | Required | Description                                                                                  |
| ------------- | ----------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `id`          | `string`                      | ✅       | Globally unique. Namespace with your extension ID: `com.yourname.ext:action-name`            |
| `title`       | `string`                      | ✅       | Label shown in the Action Drawer.                                                            |
| `extensionId` | `string`                      | ✅       | Your extension's `id` from `manifest.json`.                                                  |
| `execute`     | `() => void \| Promise<void>` | ✅       | Called when the user activates the action.                                                   |
| `description` | `string`                      | ❌       | Secondary text shown below the title.                                                        |
| `icon`        | `string`                      | ❌       | Emoji or `"icon:<name>"` shown next to the title.                                            |
| `category`    | `string`                      | ❌       | Group label. Use `ActionCategory` constants for standard groups.                             |
| `context`     | `ActionContext`               | ❌       | When this action is visible. Default: always visible.                                        |
| `shortcut`    | `string`                      | ❌       | Keyboard shortcut, shown in the drawer and bound. See [Action shortcuts](#action-shortcuts). |

### Action context reference

| `ActionContext`  | When shown                                        |
| ---------------- | ------------------------------------------------- |
| `GLOBAL`         | Always — regardless of what's open                |
| `EXTENSION_VIEW` | Only while an extension panel is open             |
| `SEARCH_VIEW`    | While the main search result list is active       |
| `RESULT`         | When a specific result item is highlighted        |
| `COMMAND_RESULT` | After a command has returned a result             |
| `CORE`           | Built-in Asyar actions — do not use in extensions |

---

### Action shortcuts

A `shortcut` is a declaration, not just a hint: the launcher shows it next to the action in the ⌘K drawer **and** runs the action when the user presses it. This works for actions you register at runtime with `registerAction`, including while your view iframe has focus — the launcher tells your iframe which chords are live and the SDK forwards exactly those key presses to it. You do not add a `keydown` listener for them.

**Format:** `Mod[+Alt][+Shift]+Key`, or a bare function key `F1`–`F24`.

- `Mod` is the platform's primary modifier: ⌘ on macOS, Ctrl on Windows and Linux. The hint is rendered per platform (`Mod+N` shows `⌘N` on macOS and `Ctrl N` elsewhere), so write it once.
- Modifiers go in the order `Mod`, `Alt`, `Shift`. The key is an uppercase letter or digit, one of ``, . / ; ' [ ] \ - = ` ``, `Space` or `Enter`.
- Examples: `Mod+N`, `Mod+Shift+C`, `Mod+Alt+Shift+F`, `Mod+Shift+,`, `F5`.

**Rules**

- **Plain keys are not bindable.** `Enter`, arrows, `Space`, `Tab`, `Esc`, `Backspace` and Shift/Alt-only chords belong to typing and list navigation. A shortcut must include `Mod` (function keys excepted).
- **Reserved:** `Mod+K`, `Mod+,`, `Mod+P`, `Mod+Q` (launcher) and `Mod+A`, `Mod+C`, `Mod+V`, `Mod+X`, `Mod+Z`, `Mod+Y`, `Mod+Shift+Z` (text editing).
- **Destructive actions get no shortcut.** An action with `destructive: true` that declares one keeps working, but its shortcut is ignored; it stays in the ⌘K drawer.
- **Only visible actions fire.** A runtime action fires while the extension's view is the active one. Shortcuts do nothing while the ⌘K drawer or a dialog is open.
- **No collisions.** Two actions that are visible together must not share a chord; the second always-visible action registered with the same chord keeps working without its shortcut. If a tie still happens the view's own action wins, then registration order, and the launcher logs a warning.
- Old formats (`"⌘N"`, `"Ctrl+N"`, `"Super+N"`) are not accepted: the action still registers, but its shortcut is ignored and the launcher logs why. Rewrite it as `Mod+N`.

---

### Standard action categories

| Constant                     | Display String | Use for                                     |
| ---------------------------- | -------------- | ------------------------------------------- |
| `ActionCategory.PRIMARY`     | Primary        | Main operations for the current view        |
| `ActionCategory.NAVIGATION`  | Navigation     | Opening views, going back, drill-down       |
| `ActionCategory.EDIT`        | Edit           | Create, update, delete operations           |
| `ActionCategory.SHARE`       | Share          | Export, copy to clipboard, send             |
| `ActionCategory.DESTRUCTIVE` | Destructive    | Irreversible actions — delete, clear, reset |
| `ActionCategory.SYSTEM`      | System         | Reserved for built-in Asyar actions         |

Custom category strings are fully supported — use them for domain-specific grouping.

---
