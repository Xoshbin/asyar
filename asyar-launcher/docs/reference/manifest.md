---
order: 1
---
## 6. The Manifest — Complete Reference

`manifest.json` lives in the project root alongside your build output. All
fields are listed below.

### Root-level fields

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `id` | `string` | ✅ | Regex: `/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/` | Reverse-domain unique identifier. **Must exactly match the directory name on disk.** Example: `com.yourname.my-extension` |
| `name` | `string` | ✅ | 2–50 characters | Human-readable display name shown in the launcher. |
| `version` | `string` | ✅ | Valid semver | Used by `asyar publish` for GitHub Release tagging. Increment before each `publish`. |
| `description` | `string` | ✅ | 10–200 characters | Short description shown in the store and launcher. |
| `author` | `string` | ✅ | — | Your name or organization. Shown in the store. |
| `type` | `"extension" \| "theme"` | ❌ | Defaults to `"extension"` | The top-level type. `"extension"` is the unified Tier 2 type — its commands choose `mode` independently. `"theme"` is a CSS-only restyle (see [Theme](./extension-types/theme.md)). The legacy values `"view"` and `"result"` are rejected at parse time. |
| `commands` | `array` | conditional | At least one entry, OR `searchable: true`, OR a `background.main` entry | See [per-command fields](#the-commands-array--per-command-fields). Empty / absent only allowed for themes or pure-searchable extensions. |
| `background` | `object` | conditional | `{ "main": "<path>" }` | Path to the compiled worker bundle. Required when any command has `mode: "background"`, or when `searchable: true`. Optional otherwise. See [extension runtime](../explanation/extension-runtime.md). |
| `searchable` | `boolean` | ❌ | — | When `true`, the launcher forwards global search queries to your worker's `search()` method and in-view input to `onViewSearch()` / `onViewSubmit()`. Requires `background.main`. |
| `permissions` | `string[]` | ❌ | Known strings only | Declare every permission your extension needs. See [permissions reference](./permissions.md). |
| `permissionArgs` | `object` | ❌ | Each key must also appear in `permissions` | Sidecar for parameterized permissions. Value shape is permission-specific. Currently only `fs:watch` uses it (value must be `string[]` of glob patterns; see the `fs:watch` section below). |
| `icon` | `string` | ❌ | Emoji or `"icon:<name>"` | Default icon for all commands. |
| `minAppVersion` | `string` | ❌ | Valid semver | Minimum Asyar app version. Extension will be marked incompatible if the app is older. |
| `asyarSdk` | `string` | ❌ | Semver range | SDK version requirement (e.g. `"^2.1.0"`). Extension will not load if the bundled SDK is older. |
| `platforms` | `string[]` | ❌ | `"macos"`, `"windows"`, `"linux"` | Restrict the extension to specific operating systems. Omit entirely for a universal extension. Extensions that don't support the current OS are hidden in the store and blocked from loading. |
| `preferences` | `PreferenceDeclaration[]` | ❌ | See [Preferences reference](./sdk/preferences.md) | Extension-level user-configurable settings. Auto-rendered as a settings panel in the launcher's Extensions tab, injected into `context.preferences` at extension boot, and synced across devices (except `password` type, which stays on-device). |
| `actions` | `ManifestAction[]` | ❌ | See [Actions reference](./actions.md#manifest-declared-actions) | Extension-level actions that appear in the ⌘K drawer whenever any command from this extension is selected in the root search results. |

### Removed fields (rejected at parse time)

The manifest schema is closed (`#[serde(deny_unknown_fields)]`). The
following legacy fields are no longer accepted; they will cause the
extension to fail discovery with an unknown-field error:

| Field | Replacement |
|---|---|
| Top-level `defaultView` | Each `mode: "view"` command declares its own `component`. |
| Top-level `main` | Worker entry is declared via `background.main`; the view iframe loads `view.html` from the package root by convention. |
| Per-command `resultType` | Per-command `mode` (`"view"` ↔ `"view"`; `"no-view"` ↔ `"background"`). |
| Per-command `view` | Per-command `component` (required iff `mode: "view"`). |

### ID naming rules

- Format: `reverse.domain.extensionname` — dot-separated segments, each starting with a lowercase letter, followed only by lowercase letters and digits.
- Regex: `/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/`
- **The directory on disk must be named exactly the same as `id`.** Asyar discovers extensions by directory name.
- ✅ Valid: `com.acme.mytool`, `io.github.username.extension`, `org.myteam.util`
- ❌ Invalid: `MyExtension`, `com.acme.my-tool` (hyphens), `com.ACME.tool`

### The `commands` array — per-command fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | ✅ | Unique within the extension. Used as the command's programmatic key. |
| `name` | `string` | ✅ | Display name shown in the launcher when the user searches. |
| `description` | `string` | ✅ | One-line description shown as subtitle. |
| `mode` | `"view" \| "background"` | ✅ | `"view"` opens a panel in the view iframe. `"background"` runs the command headlessly in the worker iframe. |
| `component` | `string` | conditional | Required when `mode === "view"`. Forbidden when `mode === "background"`. The Svelte component your `view.ts` exports under that name. |
| `icon` | `string` | ❌ | Emoji or `"icon:<name>"`. Overrides the extension-level icon. |
| `trigger` | `string` | ❌ | Keyword that triggers this command (legacy field). |
| `schedule` | `{ intervalSeconds: number }` | ❌ | Declares a recurring background timer. The command is dispatched to the worker every `intervalSeconds` seconds. Requires `mode: "background"`. Range: 10–86400 seconds. See [Background scheduling](./background-scheduling.md). |
| `preferences` | `PreferenceDeclaration[]` | ❌ | Command-scoped preferences (as opposed to the extension-level ones on the root). At runtime, a command sees the union of extension-level and command-level preferences, with command-level shadowing extension-level on name collision. Reached via `context.preferences.commands[commandId][name]`. See [Preferences reference](./sdk/preferences.md). |
| `actions` | `ManifestAction[]` | ❌ | Command-level actions that appear in the ⌘K drawer only when this specific command is selected. Combined with extension-level actions when applicable. See [Manifest-declared actions](./actions.md#manifest-declared-actions). |
| `arguments` | `CommandArgument[]` | ❌ | Inline chip-row inputs collected in the search bar before the command runs. Max 3 per command; required args must precede optional ones. Values arrive at the handler under `args.arguments.<name>`. See [Command arguments reference](./command-arguments.md). |

> **Deeplink triggering:** Every command in an enabled extension is automatically reachable via `asyar://extensions/{id}/{commandId}?args` URLs. No manifest declaration needed. See [Deeplink triggering](./deeplink-triggering.md).

### The `actions` array — per-action fields (ManifestAction)

Both the root-level `actions` field and the per-command `actions` field accept the same `ManifestAction` shape:

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `id` | `string` | ✅ | Regex: `/^[a-zA-Z][a-zA-Z0-9_-]*$/`, unique within extension | Programmatic identifier. Must be unique across both extension-level and command-level actions within the same extension. |
| `title` | `string` | ✅ | Non-empty | Label shown in the ⌘K action drawer. |
| `description` | `string` | ❌ | — | Secondary text shown below the title. |
| `icon` | `string` | ❌ | Emoji or `"icon:<name>"` | Icon next to the action title. |
| `shortcut` | `string` | ❌ | Display string only | Keyboard shortcut hint shown in the drawer (e.g. `"⌘⇧C"`). Display-only — the handler must be registered in code via `registerActionHandler`. |
| `category` | `string` | ❌ | Any string | Groups related actions under a heading in the drawer. Use `ActionCategory` constants for consistency. |

**ID format:** The host constructs a global action ID as `act_{extensionId}_{actionId}`. Example: `act_com.example.github_clone-repo`. This is the ID your handler is registered under via `registerActionHandler`.

> **Where to register handlers:** with the worker/view split, `registerActionHandler` runs from whichever role calls it. Anything that needs to fire while the panel is closed (notification action callbacks, scheduled-tick follow-ups, tray-driven actions) must register from the **worker**. Actions that only make sense with a view open can register from the view. See [extension runtime](../explanation/extension-runtime.md).

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

### Complete manifest example

```json
{
  "id": "com.yourname.note-search",
  "name": "Note Search",
  "version": "2.1.0",
  "description": "Search and preview your local Markdown notes.",
  "author": "Jane Dev",
  "icon": "📝",
  "type": "extension",
  "background": { "main": "dist/worker.js" },
  "searchable": true,
  "asyarSdk": "^2.1.0",
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
