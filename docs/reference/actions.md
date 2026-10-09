---
order: 4
---

## 9. Actions — The ⌘K Panel

Actions are keyboard-accessible commands that appear in Asyar's Action Drawer when the user presses **⌘K**. They are **contextual** — what appears depends on where the user is and what your extension has registered.

There are two ways to contribute actions:

| Approach                      | When to use                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Manifest-declared actions** | Root search — appear when the user selects your command in the main launcher, before opening any view. Declared in `manifest.json`. |
| **Programmatic actions**      | View-level — appear while your extension panel is open. Registered in code via `actionService.registerAction()`.                    |

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

## Manifest-declared actions

Manifest-declared actions let your extension contribute entries to the ⌘K drawer directly from the **root search** — without the user opening your extension view first. This is unique to Asyar: Raycast confines extension actions to their own command views.

### How it works

1. Declare actions in `manifest.json` under the root `actions` array (extension-level) or inside an individual command's `actions` array (command-level).
2. Register a handler in your extension code using `context.actions.registerActionHandler(actionId, handler)`.
3. When the user highlights your command in the main search list and presses ⌘K, the declared actions appear automatically.
4. When the user selects an action, Asyar relays the request to your extension. The registered handler runs in your extension context.

### Visibility rules

| Declaration                 | Visible when                                                      |
| --------------------------- | ----------------------------------------------------------------- |
| Extension-level `actions[]` | Any command from your extension is highlighted in the root search |
| Command-level `actions[]`   | That specific command is highlighted                              |

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
- **Canonical shortcut:** a declared `shortcut` must follow [Action shortcuts](#action-shortcuts) (e.g. `Mod+N`); glyphs like `⌘N`, plain keys and reserved chords make the extension invalid

### ManifestAction field reference

| Field         | Type     | Required | Description                                            |
| ------------- | -------- | -------- | ------------------------------------------------------ |
| `id`          | `string` | ✅       | Local identifier. Must be unique within the extension. |
| `title`       | `string` | ✅       | Label shown in the ⌘K action drawer.                   |
| `description` | `string` | ❌       | Secondary text below the title.                        |
| `icon`        | `string` | ❌       | Emoji or `"icon:<name>"`.                              |
| `shortcut`    | `string` | ❌       | Keyboard shortcut: shown in the drawer **and bound**.  |
| `category`    | `string` | ❌       | Groups related actions under a heading.                |

---

### Action shortcuts

A `shortcut` is a declaration, not just a hint: the launcher shows it next to the action in the ⌘K drawer **and** runs the action when the user presses it. This works the same for manifest-declared actions, for actions you register at runtime with `registerAction`, and while your view iframe has focus — the launcher tells your iframe which chords are live and the SDK forwards exactly those key presses to it. You do not add a `keydown` listener for them.

**Format:** `Mod[+Alt][+Shift]+Key`, or a bare function key `F1`–`F24`.

- `Mod` is the platform's primary modifier: ⌘ on macOS, Ctrl on Windows and Linux. The hint is rendered per platform (`Mod+N` shows `⌘N` on macOS and `Ctrl N` elsewhere), so write it once.
- Modifiers go in the order `Mod`, `Alt`, `Shift`. The key is an uppercase letter or digit, one of ``, . / ; ' [ ] \ - = ` ``, `Space` or `Enter`.
- Examples: `Mod+N`, `Mod+Shift+C`, `Mod+Alt+Shift+F`, `Mod+Shift+,`, `F5`.

**Rules**

- **Plain keys are not bindable.** `Enter`, arrows, `Space`, `Tab`, `Esc`, `Backspace` and Shift/Alt-only chords belong to typing and list navigation. A shortcut must include `Mod` (function keys excepted).
- **Reserved:** `Mod+K`, `Mod+,`, `Mod+P`, `Mod+Q` (launcher) and `Mod+A`, `Mod+C`, `Mod+V`, `Mod+X`, `Mod+Z`, `Mod+Y`, `Mod+Shift+Z` (text editing).
- **Destructive actions get no shortcut.** An action with `destructive: true` is rejected if it declares one; it stays in the ⌘K drawer.
- **Only visible actions fire.** A manifest action fires while its command is highlighted in root search; a runtime action fires while the extension's view is the active one. Shortcuts do nothing while the ⌘K drawer or a dialog is open.
- **No collisions.** Two actions that are visible together must not share a chord; registering a second always-visible action with the same chord throws. If a tie still happens the view's own action wins, then registration order, and the launcher logs a warning.
- Old formats (`"⌘N"`, `"Ctrl+N"`, `"Super+N"`) are not accepted. Manifests with an invalid `shortcut` fail validation at install; a runtime `registerAction` with one is rejected.

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
