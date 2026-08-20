---
order: 1
---

## 6. The Manifest — Complete Reference

`manifest.json` lives in the project root alongside your build output. All
fields are listed below.

### Root-level fields

| Field            | Type                      | Required    | Constraints                                                                                                   | Description                                                                                                                                                                                                                                                                                                                             |
| ---------------- | ------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | `string`                  | ✅          | Regex: `/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/`                                                                | Reverse-domain unique identifier. **Must exactly match the directory name on disk.** Example: `com.yourname.my-extension`                                                                                                                                                                                                               |
| `name`           | `string`                  | ✅          | 2–50 characters                                                                                               | Human-readable display name shown in the launcher.                                                                                                                                                                                                                                                                                      |
| `version`        | `string`                  | ✅          | Valid semver                                                                                                  | Used by `asyar publish` for GitHub Release tagging. Increment before each `publish`.                                                                                                                                                                                                                                                    |
| `description`    | `string`                  | ✅          | 10–200 characters                                                                                             | Short description shown in the store and launcher.                                                                                                                                                                                                                                                                                      |
| `author`         | `string`                  | ✅          | —                                                                                                             | Your name or organization. Shown in the store.                                                                                                                                                                                                                                                                                          |
| `type`           | `"extension" \| "theme"`  | ❌          | Defaults to `"extension"`                                                                                     | The top-level type. `"extension"` is the unified Tier 2 type — its commands choose `mode` independently. `"theme"` is a CSS-only restyle (see [Theme](./extension-types/theme.md)). The legacy values `"view"` and `"result"` are rejected at parse time.                                                                               |
| `commands`       | `array`                   | conditional | At least one entry, OR `searchable: true`, OR a `background.main` entry                                       | See [per-command fields](#the-commands-array--per-command-fields). Empty / absent only allowed for themes or pure-searchable extensions.                                                                                                                                                                                                |
| `background`     | `object`                  | conditional | `{ "main": "<path>" }`                                                                                        | Path to the compiled worker bundle. Required when any command has `mode: "background"`, or when `searchable: true`. Optional otherwise. See [extension runtime](../explanation/extension-runtime.md).                                                                                                                                   |
| `searchable`     | `boolean`                 | ❌          | —                                                                                                             | When `true`, the launcher forwards global search queries to your worker's `search()` method and in-view input to `onViewSearch()` / `onViewSubmit()`. Requires `background.main`.                                                                                                                                                       |
| `permissions`    | `string[]`                | ❌          | Known strings only                                                                                            | Declare every permission your extension needs. See [permissions reference](./permissions.md).                                                                                                                                                                                                                                           |
| `permissionArgs` | `object`                  | ❌          | Each key must also appear in `permissions`                                                                    | Sidecar for parameterized permissions. Value shape is permission-specific. Currently only `fs:watch` uses it (value must be `string[]` of glob patterns; see the `fs:watch` section below).                                                                                                                                             |
| `runtimes`       | `string[]`                | ❌          | Known runtime names only: `bun`, `claude`, `uv`                                                               | On-demand sidecar runtimes your extension needs at execution time. Nothing is bundled with the app — a declared runtime is downloaded once on first use (behind a consent dialog that shows its download size alongside your permissions) and shared across every extension that requests it. Unknown names are rejected at parse time. |
| `icon`           | `string`                  | ❌          | Emoji or `"icon:<name>"`                                                                                      | Default icon for all commands.                                                                                                                                                                                                                                                                                                          |
| `minAppVersion`  | `string`                  | ❌          | Valid semver                                                                                                  | Minimum Asyar app version. Extension will be marked incompatible if the app is older.                                                                                                                                                                                                                                                   |
| `asyarSdk`       | `string`                  | ❌          | Semver range                                                                                                  | SDK version requirement (e.g. `"^2.7.0"`). Extension will not load if the bundled SDK is older.                                                                                                                                                                                                                                         |
| `platforms`      | `string[]`                | ❌          | `"macos"`, `"windows"`, `"linux"`                                                                             | Restrict the extension to specific operating systems. Omit entirely for a universal extension. Extensions that don't support the current OS are hidden in the store and blocked from loading.                                                                                                                                           |
| `preferences`    | `PreferenceDeclaration[]` | ❌          | See [Preferences reference](./sdk/preferences.md)                                                             | Extension-level user-configurable settings. Auto-rendered as a settings panel in the launcher's Extensions tab, injected into `context.preferences` at extension boot, and synced across devices (except `password` type, which stays on-device).                                                                                       |
| `actions`        | `ManifestAction[]`        | ❌          | See [Actions reference](./actions.md#manifest-declared-actions)                                               | Extension-level actions that appear in the ⌘K drawer whenever any command from this extension is selected in the root search results.                                                                                                                                                                                                   |
| `tools`          | `ManifestTool[]`          | ❌          | Each `id` must be unique within the extension and must not contain `:`. Requires `tools:register` permission. | Tools your extension exports to the agent runtime. See [Built-in Tools Reference](./builtin-tools.md) for Tier 1 tools and [Register extension tools](../how-to/register-extension-tools.md) for the authoring guide. Runtime API documented at [ToolsService](./sdk/tools-service.md).                                                 |
| `walkthrough`    | `WalkthroughTask[]`       | ❌          | Each `id` must be unique within the extension and match `/^[A-Za-z0-9._-]+$/`.                                | Tasks that teach your extension's features, shown in the launcher's **Walkthrough** command. See [the walkthrough section](#walkthrough--teaching-your-features) below. No permission required and no runtime code — the launcher decides when each task is complete by watching real usage.                                            |

### Removed fields (rejected at parse time)

The manifest schema is closed (`#[serde(deny_unknown_fields)]`). The
following legacy fields are no longer accepted; they will cause the
extension to fail discovery with an unknown-field error:

| Field                    | Replacement                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Top-level `defaultView`  | Each `mode: "view"` command declares its own `component`.                                                              |
| Top-level `main`         | Worker entry is declared via `background.main`; the view iframe loads `view.html` from the package root by convention. |
| Per-command `resultType` | Per-command `mode` (`"view"` ↔ `"view"`; `"no-view"` ↔ `"background"`).                                                |
| Per-command `view`       | Per-command `component` (required iff `mode: "view"`).                                                                 |

### ID naming rules

- Format: `reverse.domain.extensionname` — dot-separated segments, each starting with a lowercase letter, followed only by lowercase letters and digits.
- Regex: `/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/`
- **The directory on disk must be named exactly the same as `id`.** Asyar discovers extensions by directory name.
- ✅ Valid: `com.acme.mytool`, `io.github.username.extension`, `org.myteam.util`
- ❌ Invalid: `MyExtension`, `com.acme.my-tool` (hyphens), `com.ACME.tool`

### The `commands` array — per-command fields

| Field                | Type                            | Required    | Description                                                                                                                                                                                                                                                                                                                                             |
| -------------------- | ------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | `string`                        | ✅          | Unique within the extension. Used as the command's programmatic key.                                                                                                                                                                                                                                                                                    |
| `name`               | `string`                        | ✅          | Display name shown in the launcher when the user searches.                                                                                                                                                                                                                                                                                              |
| `description`        | `string`                        | ✅          | One-line description shown as subtitle.                                                                                                                                                                                                                                                                                                                 |
| `mode`               | `"view" \| "background"`        | ✅          | `"view"` opens a panel in the view iframe. `"background"` runs the command headlessly in the worker iframe.                                                                                                                                                                                                                                             |
| `component`          | `string`                        | conditional | Required when `mode === "view"`. Forbidden when `mode === "background"`. The Svelte component your `view.ts` exports under that name.                                                                                                                                                                                                                   |
| `icon`               | `string`                        | ❌          | Emoji or `"icon:<name>"`. Overrides the extension-level icon.                                                                                                                                                                                                                                                                                           |
| `trigger`            | `string`                        | ❌          | Keyword that triggers this command (legacy field).                                                                                                                                                                                                                                                                                                      |
| `schedule`           | `{ intervalSeconds: number }`   | ❌          | Declares a recurring background timer. The command is dispatched to the worker every `intervalSeconds` seconds. Requires `mode: "background"`. Range: 10–86400 seconds. See [Background scheduling](./background-scheduling.md).                                                                                                                        |
| `searchable`         | `boolean`                       | ❌          | If `false`, the command is excluded from the launcher's root search index. Useful for scheduled background tasks or internal worker commands. Defaults to `true`.                                                                                                                                                                                       |
| `preferences`        | `PreferenceDeclaration[]`       | ❌          | Command-scoped preferences (as opposed to the extension-level ones on the root). At runtime, a command sees the union of extension-level and command-level preferences, with command-level shadowing extension-level on name collision. Reached via `context.preferences.commands[commandId][name]`. See [Preferences reference](./sdk/preferences.md). |
| `actions`            | `ManifestAction[]`              | ❌          | Command-level actions that appear in the ⌘K drawer only when this specific command is selected. Combined with extension-level actions when applicable. See [Manifest-declared actions](./actions.md#manifest-declared-actions).                                                                                                                         |
| `arguments`          | `CommandArgument[]`             | ❌          | Inline chip-row inputs collected in the search bar before the command runs. Max 3 per command; required args must precede optional ones. Values arrive at the handler under `args.arguments.<name>`. See [Command arguments reference](./command-arguments.md).                                                                                         |
| `searchBarAccessory` | `SearchBarAccessoryDeclaration` | ❌          | Per-command dropdown the launcher renders in the top-right of the search bar while the view is active. Only valid when `mode === "view"`. See [Search bar accessory reference](./searchbar-accessory.md).                                                                                                                                               |

> **Deeplink triggering:** Every command in an enabled extension is automatically reachable via `asyar://extensions/{id}/{commandId}?args` URLs. No manifest declaration needed. See [Deeplink triggering](./deeplink-triggering.md).

### The `actions` array — per-action fields (ManifestAction)

Both the root-level `actions` field and the per-command `actions` field accept the same `ManifestAction` shape:

| Field         | Type     | Required | Constraints                                                  | Description                                                                                                                                   |
| ------------- | -------- | -------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | `string` | ✅       | Regex: `/^[a-zA-Z][a-zA-Z0-9_-]*$/`, unique within extension | Programmatic identifier. Must be unique across both extension-level and command-level actions within the same extension.                      |
| `title`       | `string` | ✅       | Non-empty                                                    | Label shown in the ⌘K action drawer.                                                                                                          |
| `description` | `string` | ❌       | —                                                            | Secondary text shown below the title.                                                                                                         |
| `icon`        | `string` | ❌       | Emoji or `"icon:<name>"`                                     | Icon next to the action title.                                                                                                                |
| `shortcut`    | `string` | ❌       | Display string only                                          | Keyboard shortcut hint shown in the drawer (e.g. `"⌘⇧C"`). Display-only — the handler must be registered in code via `registerActionHandler`. |
| `category`    | `string` | ❌       | Any string                                                   | Groups related actions under a heading in the drawer. Use `ActionCategory` constants for consistency.                                         |

**ID format:** The host constructs a global action ID as `act_{extensionId}_{actionId}`. Example: `act_com.example.github_clone-repo`. This is the ID your handler is registered under via `registerActionHandler`.

> **Where to register handlers:** with the worker/view split, `registerActionHandler` runs from whichever role calls it. Anything that needs to fire while the panel is closed (notification action callbacks, scheduled-tick follow-ups, tray-driven actions) must register from the **worker**. Actions that only make sense with a view open can register from the view. See [extension runtime](../explanation/extension-runtime.md).

### The `tools` array — per-tool fields (ManifestTool)

The root-level `tools` field declares the tools your extension contributes to the agent runtime. Each entry is a `ManifestTool`:

| Field         | Type                      | Required | Constraints                                        | Description                                                                                                                                                                          |
| ------------- | ------------------------- | -------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`          | `string`                  | ✅       | Unique within the extension. Must NOT contain `:`. | Short programmatic identifier (e.g. `lookup-contact`). The Rust registry builds the fully-qualified id as `<extensionId>:<id>`, so the colon character is reserved as the separator. |
| `name`        | `string`                  | ✅       | Non-empty                                          | Human-readable label shown to the agent and in the tool-picker UI.                                                                                                                   |
| `description` | `string`                  | ✅       | Non-empty                                          | What the tool does. The agent LLM reads this when deciding whether to invoke the tool — write it as a clear, concise imperative sentence.                                            |
| `parameters`  | `Record<string, unknown>` | ✅       | Valid JSON Schema object                           | Describes the tool's input arguments. The agent passes an object conforming to this schema when it invokes your tool; your handler receives it as `args`.                            |

The `tools:register` permission must also be declared in `permissions`. Without it, the launcher rejects the manifest.

See [ToolsService](./sdk/tools-service.md) for the runtime API (`registerTool`, `unregisterTool`, `listTools`) and the [Register extension tools](../how-to/register-extension-tools.md) guide for the end-to-end authoring flow.

### `walkthrough` — teaching your features

The **Walkthrough** command in the launcher is a task list that teaches Asyar
over time. Your extension contributes tasks to it the same way it contributes
commands — declaratively, in `manifest.json`.

You write no code for this. A task declares _what counts as having learned
it_, and the launcher decides when that happened by watching what the user
actually launches. There is no API to call and no completion event to emit.

Two consequences worth designing around:

- **Completion is retroactive.** The launcher measures a task against the
  user's whole usage history, not the history since the task shipped. A task
  you add in v2 of your extension opens already complete for someone who has
  been using that feature since v1.
- **Completion latches.** Once a task is done it stays done, even if the user
  later clears their usage history.

#### Per-task fields (WalkthroughTask)

| Field        | Type             | Required | Constraints                                    | Description                                                                                                                              |
| ------------ | ---------------- | -------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | `string`         | ✅       | Unique within the extension, `[A-Za-z0-9._-]+` | Short identifier. The launcher qualifies it as `wt_<extensionId>_<id>`, the same way commands become `cmd_<extensionId>_<commandId>`.    |
| `title`      | `string`         | ✅       | Non-empty                                      | The one line shown in the task list. Write the benefit, not the mechanism — "Never lose what you copied" beats "Use clipboard history".  |
| `summary`    | `string`         | ❌       | —                                              | Subtitle in the list. Defaults to a description generated from the completion rule.                                                      |
| `body`       | `string`         | ❌       | Markdown                                       | The detail page. Convention is a short "why this matters", then a `## To complete the task` section with numbered steps.                 |
| `icon`       | `string`         | ❌       | Emoji or `"icon:<name>"`                       | Shown beside the task in the list.                                                                                                       |
| `image`      | `string`         | ❌       | Local asset path                               | Preview image on the detail page. Must ship inside your extension — remote URLs are not fetched, so the walkthrough still works offline. |
| `order`      | `number`         | ❌       | Defaults to `0`                                | Ascending sort key across the whole combined list, not just your tasks. Ties break on id.                                                |
| `completion` | `CompletionRule` | ✅       | See below                                      | How the task decides it is done.                                                                                                         |

#### Completion rules

| Rule     | Shape                                                                    | Completes when                                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `launch` | `{ "type": "launch", "target": "<glob>" }`                               | Any launch matches `target`. Globs match against object ids — `cmd_<extensionId>_<commandId>` for commands, `app_<name>` for applications.                                                                      |
| `count`  | `{ "type": "count", "target": "<glob>", "times": n, "distinctDays": n }` | `times` matching launches have happened **and** they span `distinctDays` separate days. Both default to 1. Counts sum and days union across every id the glob matches.                                          |
| `state`  | `{ "type": "state", "probe": "<name>", "atLeast": n }`                   | A launcher-reported counter reaches `atLeast` (default 1). For facts no launch can express — `snippets.count`, `portals.count`, `notes.count`, `aliases.count`, `shortcuts.count`, `extensions.installedCount`. |
| `manual` | `{ "type": "manual" }`                                                   | Never automatically. The user ticks it themselves. Use this only when nothing observable corresponds to the task.                                                                                               |

Use `distinctDays` when the point of the feature is the habit rather than the
visit. "Opened clipboard history once" teaches nobody anything; "reached for
it on three separate days" means it stuck.

```json
{
  "walkthrough": [
    {
      "id": "first-search",
      "title": "Find a track without leaving the keyboard",
      "summary": "Search your library straight from Asyar",
      "icon": "icon:store",
      "order": 50,
      "body": "Type an artist and hit Enter.\n\n## To complete the task\n\nRun **Search Library** and open a result.",
      "completion": { "type": "launch", "target": "cmd_com.you.music_search" }
    }
  ]
}
```

### Validation rules

The Rust discovery parser enforces:

- `type` defaults to `"extension"`. Only `"extension"` and `"theme"` are legal — `"view"` / `"result"` are rejected.
- `type === "theme"` requires an empty / absent `commands` array, forbids `background`, and requires a sibling `theme.json`.
- `type === "extension"` requires at least one of: a non-empty `commands` array, `searchable: true`, or `background.main`. A fully empty extension is rejected.
- `mode === "view"` requires a non-empty `component` string.
- `mode === "background"` forbids `component`.
- At least one `mode === "background"` command — or `searchable: true` — requires `background.main`.
- `background.main` without any background commands and without `searchable` is permitted (push-event-only extensions).
- Unknown fields are rejected via `#[serde(deny_unknown_fields)]`. Old manifests with `defaultView` / `resultType` / etc. fail discovery.

### Parameterized permissions — `permissionArgs`

Some permissions need a value in addition to being declared. Those values live in the `permissionArgs` object, keyed by the permission name:

```json
{
  "permissions": ["fs:watch"],
  "permissionArgs": {
    "fs:watch": ["~/Library/Shortcuts/**", "~/.ssh/config"]
  }
}
```

**Rules enforced at manifest load time:**

- Every key in `permissionArgs` must also appear in `permissions`. Declaring `permissionArgs.fs:watch` without `"fs:watch"` in `permissions` is rejected.
- The reverse is also enforced for `fs:watch` — declaring the permission without providing the patterns is rejected (you'd have no scope to watch).
- `fs:watch` value must be `string[]`. Each entry is a [`globset`](https://docs.rs/globset/)-compatible pattern (`*`, `**`, `?`, `[abc]`, `{a,b}`).
- Leading `~/` is expanded to the user's home directory at load time.
- Every pattern must resolve **under `$HOME` or `/tmp`**. Patterns resolving to `/etc`, `/usr`, another user's home, or absolute system paths are rejected.

See [`FileSystemWatcherService`](./sdk/file-system-watcher.md) for the runtime surface.

### Permission Consent and Review

When an extension declares permissions or updates its declared permission set:

- **Initial Linking / Installation / Updates:** Extensions that declare permissions require user consent before those permissions are registered in the Rust security registry.
- **Proactive Prompt on Command Launch:** If an extension has unreviewed permissions (e.g. freshly linked via `asyar link` or updated), launching any command of that extension from the launcher automatically triggers the permission consent review dialog before opening the view or dispatching the background command.
- **Consent Decision Flow:**
  - If the user accepts, the consent record is persisted, permissions are registered immediately (and running background workers are remounted), and the command execution proceeds normally.
  - If the user declines or cancels, command execution aborts cleanly without navigating or dispatching.

### Complete manifest example

```json
{
  "id": "com.yourname.note-search",
  "name": "Note Search",
  "version": "2.2.0",
  "description": "Search and preview your local Markdown notes.",
  "author": "Jane Dev",
  "icon": "📝",
  "type": "extension",
  "background": { "main": "dist/worker.js" },
  "searchable": true,
  "asyarSdk": "^2.7.0",
  "minAppVersion": "1.0.0",
  "platforms": ["macos", "linux"],
  "permissions": ["network", "notifications:send"],
  "preferences": [
    {
      "name": "notesDirectory",
      "type": "directory",
      "title": "Notes directory",
      "description": "Root folder to index.",
      "required": true
    },
    {
      "name": "previewFontSize",
      "type": "number",
      "title": "Preview font size",
      "default": 14
    }
  ],
  "actions": [
    {
      "id": "open-settings",
      "title": "Extension Settings",
      "description": "Configure Note Search preferences",
      "icon": "icon:settings",
      "shortcut": "⌘,",
      "category": "System"
    }
  ],
  "commands": [
    {
      "id": "search",
      "name": "Search Notes",
      "description": "Live search your local notes as you type",
      "mode": "view",
      "component": "DetailView",
      "icon": "🔍",
      "actions": [
        {
          "id": "export-note",
          "title": "Export Note",
          "description": "Save the selected note as a file",
          "icon": "icon:download",
          "shortcut": "⌘⇧E",
          "category": "Share"
        }
      ]
    },
    {
      "id": "new-note",
      "name": "New Note",
      "description": "Create a new blank note",
      "mode": "background",
      "icon": "✏️"
    },
    {
      "id": "sync-notes",
      "name": "Sync Notes",
      "description": "Periodically sync notes from remote",
      "mode": "background",
      "searchable": false,
      "schedule": { "intervalSeconds": 300 },
      "preferences": [
        {
          "name": "remoteUrl",
          "type": "textfield",
          "title": "Remote sync URL"
        }
      ]
    }
  ]
}
```

---
