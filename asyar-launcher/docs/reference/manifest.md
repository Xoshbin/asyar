---
order: 1
---
## 6. The Manifest — Complete Reference

`manifest.json` lives in the project root alongside `index.html`. All fields are listed below.

### Root-level fields

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `id` | `string` | ✅ | Regex: `/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/` | Reverse-domain unique identifier. **Must exactly match the directory name on disk.** Example: `com.yourname.my-extension` |
| `name` | `string` | ✅ | 2–50 characters | Human-readable display name shown in the launcher. |
| `version` | `string` | ✅ | Valid semver | Used by `asyar publish` for GitHub Release tagging. Increment before each `publish`. |
| `description` | `string` | ✅ | 10–200 characters | Short description shown in the store and launcher. |
| `author` | `string` | ✅ | — | Your name or organization. Shown in the store. |
| `commands` | `array` | ✅ | At least one entry | See [extension types](./extension-types/README.md). |
| `permissions` | `string[]` | ❌ | Known strings only | Declare every permission your extension needs. See [permissions reference](./permissions.md). |
| `permissionArgs` | `object` | ❌ | Each key must also appear in `permissions` | Sidecar for parameterized permissions. Value shape is permission-specific. Currently only `fs:watch` uses it (value must be `string[]` of glob patterns; see the `fs:watch` section below). |
| `icon` | `string` | ❌ | Emoji or `"icon:<name>"` | Default icon for all commands. |
| `defaultView` | `string` | ❌ | — | Component name rendered when no command specifies a `view`. Required if any command has `resultType: "view"` with no `view` field. |
| `type` | `"result" \| "view" \| "theme"` | ❌ | — | `"theme"` declares a CSS variable theme (see [Type 3](#type-3-theme-extension-theme)). For `"view"` and `"result"` this is a legacy hint — prefer `resultType` on individual commands. |
| `searchable` | `boolean` | ❌ | — | When `true`, forwards global search queries to your `search()` method and in-view input to `onViewSearch()`/`onViewSubmit()`. |
| `main` | `string` | ❌ | Relative path | Path to the compiled JS class file (e.g. `"dist/index.js"`). **Required if `searchable: true`** — the host imports this file to call `search()`. |
| `minAppVersion` | `string` | ❌ | Valid semver | Minimum Asyar app version. Extension will be marked incompatible if the app is older. |
| `asyarSdk` | `string` | ❌ | Semver range | SDK version requirement (e.g. `"^1.2.0"`). Extension will not load if the bundled SDK is older. |
| `platforms` | `string[]` | ❌ | `"macos"`, `"windows"`, `"linux"` | Restrict the extension to specific operating systems. Omit entirely for a universal extension. Extensions that don't support the current OS are hidden in the store and blocked from loading. |
| `preferences` | `PreferenceDeclaration[]` | ❌ | See [Preferences reference](./sdk/preferences.md) | Extension-level user-configurable settings. Auto-rendered as a settings panel in the launcher's Extensions tab, injected into `context.preferences` at extension boot, and synced across devices (except `password` type, which stays on-device). |
| `actions` | `ManifestAction[]` | ❌ | See [Actions reference](./actions.md#manifest-declared-actions) | Extension-level actions that appear in the ⌘K drawer whenever any command from this extension is selected in the root search results. See [Manifest-declared actions](./actions.md#manifest-declared-actions). |

### ID naming rules

- Format: `reverse.domain.extensionname` — dot-separated segments, each starting with a lowercase letter, followed only by lowercase letters and digits.
- Regex: `/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/`
- **The directory on disk must be named exactly the same as `id`.** Asyar discovers extensions by directory name.
- ✅ Valid: `com.acme.my-tool` → **No**, hyphens are not allowed
- ✅ Valid: `com.acme.mytool`, `io.github.username.extension`, `org.myteam.util`
- ❌ Invalid: `MyExtension`, `com.acme.my-tool`, `com.ACME.tool`

### The `commands` array — per-command fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | ✅ | Unique within the extension. Used as the command's programmatic key. |
| `name` | `string` | ✅ | Display name shown in the launcher when the user searches. |
| `description` | `string` | ✅ | One-line description shown as subtitle. |
| `resultType` | `"view" \| "no-view"` | ✅ | `"view"` opens a panel. `"no-view"` executes silently. |
| `view` | `string` | ❌ | Component name to render for `resultType: "view"`. Falls back to manifest `defaultView`. |
| `icon` | `string` | ❌ | Emoji or `"icon:<name>"`. Overrides the extension-level icon. |
| `trigger` | `string` | ❌ | Keyword that triggers this command (legacy field). |
| `schedule` | `{ intervalSeconds: number }` | ❌ | Declares a recurring background timer. The command is called every `intervalSeconds` seconds. Requires `resultType: "no-view"`. Range: 10–86400 seconds. See [Background scheduling](./background-scheduling.md). |
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
  "main": "dist/index.js",
  "searchable": true,
  "type": "result",
  "defaultView": "DetailView",
  "asyarSdk": "^1.16.2",
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
      "resultType": "view",
      "view": "DetailView",
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
      "resultType": "no-view",
      "icon": "✏️"
    },
    {
      "id": "sync-notes",
      "name": "Sync Notes",
      "description": "Periodically sync notes from remote",
      "resultType": "no-view",
      "schedule": {
        "intervalSeconds": 300
      },
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
